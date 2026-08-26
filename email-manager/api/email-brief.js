// api/email-brief.js
// Javari AI Email Manager — Active Management + Morning Brief
//
// Actions taken automatically every run:
//   • Notifications  → moved to "Javari/Notifications" (Gmail) / "Javari-Notifications" (M365)
//   • Junk           → moved to "Javari/Junk-Review"   / "Javari-Junk-Review"  — NEVER deleted
//   • Action items   → moved to "Javari/Action-Required" / "Javari-Action-Required",
//                      listed individually with a specific follow-up instruction
//   • Verifications  → the link is FOLLOWED, but only for allowlisted senders (see VERIFY)
//   • Unsorted       → LEFT IN THE INBOX, untouched, and listed in the brief
//   • Forgotten drafts (7d+) → surfaced in the brief, no auto-action
//
// Original: 2026-08-20. Revised 2026-08-26 — see CHANGES below.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES 2026-08-26
//
// 1. IT ONLY EVER SAW UNREAD MAIL. Gmail queried `in:inbox is:unread` and Graph
//    filtered `isRead eq false`, so every message Roy had already opened was
//    invisible forever. That is why the backlog was never touched. Both filters
//    are gone; the whole inbox is now in scope.
//
//    Removing them safely required making the run idempotent, because read mail
//    does not clear itself the way unread mail does. Every classified message is
//    now MOVED OUT of the inbox, so the next run simply cannot see it again.
//    Unsorted mail stays put and is tagged, and the tag is what excludes it.
//
// 2. IT SILENTLY ARCHIVED ANYTHING IT DID NOT RECOGNISE. classify() ended with
//    `return 'notif'` — a plain note from a human with an ordinary subject was
//    filed out of the inbox as a notification. That is exactly the failure Roy
//    was worried about with autofiling, and it was live. Unrecognised mail is
//    now 'unsorted': it STAYS IN THE INBOX and is listed in the brief. The rule
//    is that this thing may only move mail it can actually name.
//
// 3. NOTIFICATIONS WERE CHECKED LAST. The order was junk → action → notif, and
//    RX_ACTION matches "invoice", "renewal", "expir", "confirm" — words in half
//    the marketing mail ever sent. A newsletter saying "Renew now" became an
//    action item. Automated senders are now identified BEFORE the action words
//    are applied, so only mail from a human can become an action.
//
// 4. THE SUBJECT LINE WAS MOJIBAKE. It carried a raw emoji in a header with no
//    RFC 2047 encoding, so it arrived as "Ã°ÂŸÂ—Â‚Ã¯Â¸Â Javari filed 536".
//    Headers are 7-bit; non-ASCII has to be encoded. Now it is.
//
// 5. M365 MOVED MESSAGES ONE HTTP CALL AT A TIME. accounts@ alone files ~456 a
//    day — 456 sequential round trips against a function timeout. Now batched
//    20 per request through Graph's $batch endpoint.
//
// 6. IT TRUNCATED AT 500 PER MAILBOX AND SAID NOTHING. A silent cap reads as
//    "all clear". The cap is still there (a run has to end) but the brief now
//    says when it was hit and how much is left.
//
// 7. THERE WAS NO WAY TO TEST IT WITHOUT IT ACTING. A function that moves ~500
//    real messages a day across 14 live mailboxes needs a way to answer "what
//    WOULD you do" before it does it. `?dryRun=1` now classifies everything,
//    returns the exact brief it would have sent, and touches nothing: no moves,
//    no labels, no links followed, no mail sent, no database write.
//
// CR AudioViz AI, LLC · EIN 39-3646201
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const BRIEF_FROM = 'craudiovizai@gmail.com';
const BRIEF_TO   = 'royhenders@gmail.com';

const GMAIL_ACCOUNTS = [
  { label: 'royhenders@gmail.com',   tokenEnv: 'GMAIL_REFRESH_TOKEN_ROY' },
  { label: 'craudiovizai@gmail.com', tokenEnv: 'GMAIL_REFRESH_TOKEN_CRAUDIOVIZAI' },
];

const GL = {
  action:   'Javari/Action-Required',
  notif:    'Javari/Notifications',
  junk:     'Javari/Junk-Review',
  unsorted: 'Javari/Unsorted',
};

const MF = {
  action:   'Javari-Action-Required',
  notif:    'Javari-Notifications',
  junk:     'Javari-Junk-Review',
};

// How many messages one run will look at per mailbox. A run has to end
// somewhere; the brief reports when this bites so a truncated sweep never
// reads as a finished one.
const PER_MAILBOX_LIMIT = 600;

// ── Classification ────────────────────────────────────────────────────────────
const RX_JUNK   = /\b(casino|lottery|you have won|prize claim|million dollars|unclaimed funds|investment opportunity|click here now|act now|make money fast|double your|work from home)\b/i;
const RX_ACTION = /\b(please respond|urgent|action required|response needed|deadline|asap|review needed|approval needed|please sign|payment due|overdue|past due|final notice)\b/i;

// An automated sender. Checked BEFORE the action words: see CHANGES note 3.
const RX_NOTIF  = /no.?reply|noreply|do.not.reply|notifications?@|alert@|alerts@|mailer@|mailer-daemon|automated@|system@|postmaster|bounce@|updates?@|news@|newsletter|marketing@|@amazonses|@sendgrid|@mailchimp|@sparkpostmail|@mandrillapp/i;

/**
 * Bucket one message.
 *
 * Returns 'unsorted' rather than guessing. Everything downstream treats
 * unsorted as "leave it exactly where it is", which is the only safe default
 * for mail this function does not understand.
 */
function classify(from, subject) {
  const t = `${from} ${subject}`;
  if (RX_JUNK.test(t)) return 'junk';
  // Automated first. An automated sender cannot raise an action item no matter
  // how urgent its marketing copy sounds.
  if (RX_NOTIF.test(from)) return 'notif';
  if (RX_ACTION.test(t)) return 'action';
  return 'unsorted';
}

// ── Automatic verification ────────────────────────────────────────────────────
//
// Roy asked for this: "if it says click to verify, you would do it."
//
// It is also the single most exploited pattern in phishing, so it is fenced in
// hard. A link is followed ONLY when ALL of the following hold:
//
//   1. the sender's registrable domain is on VERIFY_SENDERS — services we
//      actually signed up with, not "anything that looks official";
//   2. the link's own host is on the same list — a real verification mail from
//      AWIN points at AWIN, and a forged one points somewhere else;
//   3. the subject or link looks like address confirmation, not a credential
//      operation;
//   4. nothing in RX_NEVER_CLICK appears anywhere in the message.
//
// Anything that fails any test is not clicked. It becomes an action item with
// the link quoted and the reason stated, which costs Roy ten seconds and cannot
// hand an account to a stranger.
const VERIFY_SENDERS = [
  'awin.com', 'awin.net', 'cj.com', 'linksynergy.com', 'rakutenadvertising.com',
  'impact.com', 'flexoffers.com', 'partnerize.com', 'ascendpartner.com',
  'ko-fi.com', 'clickbank.com', 'shareasale.com', 'amazon.com',
];

const RX_VERIFY_INTENT = /\b(verify (your )?(e-?mail|address|account)|confirm (your )?(e-?mail|address|subscription)|activate (your )?account|email verification|confirm your registration)\b/i;

// If any of these appear, no link is followed under any circumstances. These
// are the operations where a click is the whole attack.
const RX_NEVER_CLICK = /\b(password|passcode|reset your|sign in|log ?in|credential|two.factor|2fa|mfa|authenticator|bank|routing number|wire transfer|payment method|credit card|billing details|ssn|social security|tax id)\b/i;

function registrableDomain(address) {
  const m = /@([^>\s]+)/.exec(address || '');
  if (!m) return '';
  const host = m[1].toLowerCase().replace(/[>,;]+$/, '');
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

function onList(host, list) {
  const h = (host || '').toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Decide whether a message's verification link may be followed, and which one.
 * Returns { ok: true, url } or { ok: false, reason }.
 */
function verifyDecision(from, subject, bodyText) {
  const haystack = `${subject}\n${bodyText}`;

  if (RX_NEVER_CLICK.test(haystack)) {
    return { ok: false, reason: 'mentions credentials or payment — never auto-clicked' };
  }
  if (!RX_VERIFY_INTENT.test(haystack)) {
    return { ok: false, reason: 'not an address-confirmation message' };
  }

  const senderDomain = registrableDomain(from);
  if (!onList(senderDomain, VERIFY_SENDERS)) {
    return { ok: false, reason: `sender ${senderDomain || 'unknown'} is not a service we signed up with` };
  }

  const urls = bodyText.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  for (const raw of urls) {
    let host;
    try { host = new URL(raw).hostname; } catch { continue; }
    if (!onList(host, VERIFY_SENDERS)) continue;
    if (!/verif|confirm|activat/i.test(raw)) continue;
    return { ok: true, url: raw };
  }
  return { ok: false, reason: 'no verification link on the sender\'s own domain' };
}

async function followVerification(url) {
  // GET only. A verification link is a GET by construction; anything that needs
  // a POST is a form, and submitting forms unattended is not something this
  // function does.
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': 'JavariEmailManager/1.0 (+craudiovizai.com)' },
  });
  return { status: res.status, finalUrl: res.url };
}

// ── Smart follow-up suggestions ────────────────────────────────────────────────
function suggestFollowUp(from, subject) {
  const t = `${from} ${subject}`.toLowerCase();
  const f = from.toLowerCase();

  if (/awin\.com|awin\.net/.test(f))
    return 'Affiliate network (AWIN) — log in to dashboard and approve/reject merchant or review payout';
  if (/cj\.com|commissionjunction/.test(f))
    return 'Affiliate network (CJ) — log in to dashboard and approve/reject advertiser application';
  if (/impact\.com|impactradius/.test(f))
    return 'Affiliate network (Impact) — log in to dashboard and review partner or commission update';
  if (/rakuten|linksynergy/.test(f))
    return 'Affiliate network (Rakuten) — log in to dashboard and review publisher or merchant update';
  if (/\b(merchant|advertiser|publisher|affiliate|partner program)\b/.test(t))
    return 'New merchant or affiliate partner — review terms and add to Javari affiliate catalog if approved';

  if (/\b(overdue|past due|collection|final notice)\b/.test(t))
    return 'Overdue payment — pay immediately or contact vendor to dispute';
  if (/\b(invoice|bill|payment due|amount due|receipt)\b/.test(t))
    return 'Invoice or payment due — verify amount, check vendor, schedule payment or mark paid';
  if (/\b(refund|chargeback|dispute)\b/.test(t))
    return 'Refund or dispute — review transaction and respond to processor within deadline';
  if (/stripe\.com|paypal\.com|square\.com/.test(f))
    return 'Payment processor alert — log in and review account action required';

  if (/\b(trademark|copyright|dmca|cease)\b/.test(t))
    return 'IP or legal notice — do not ignore, forward to attorney immediately';
  if (/\b(contract|agreement|sign|docusign|hellosign|e-sign)\b/.test(t))
    return 'Document requires your signature — open attachment or DocuSign link and sign';
  if (/\b(legal|attorney|lawsuit|subpoena|compliance)\b/.test(t))
    return 'Legal matter — forward to attorney or respond within stated deadline';

  if (/\b(domain|ssl|certificate)\b/.test(t))
    return 'Domain or SSL renewal — renew now if keeping, let lapse if not needed';
  if (/\b(renew|renewal|expir|subscription ending|cancel by)\b/.test(t))
    return 'Renewal or expiration — decide keep or cancel; act before deadline to avoid auto-charge';

  if (/\b(password reset|two.factor|2fa|mfa)\b/.test(t))
    return 'Security action — complete in account settings; ignore if you did not initiate';
  if (/\b(verify|verification|confirm your|account suspended|locked|unusual activity|security alert)\b/.test(t))
    return 'Account security or verification — log in directly (do not click email links) and confirm';

  if (/\b(interview|schedule a call|meeting request|calendly)\b/.test(t))
    return 'Meeting or call request — reply with availability or use their scheduling link';
  if (/\b(job offer|proposal|partnership|collaboration|opportunity)\b/.test(t))
    return 'Business opportunity or proposal — review details and reply accept, decline, or schedule call';

  if (/\b(support ticket|help desk|customer complaint|refund request)\b/.test(t))
    return 'Customer support issue — respond within 24h to maintain satisfaction';
  if (/\b(order|shipment|tracking|delivery issue)\b/.test(t))
    return 'Order or shipping issue — check order status and reply to customer with update';

  if (/\.gov|irs\.gov|sba\.gov/.test(f))
    return 'Government communication — read carefully, respond by any stated deadline, retain for records';
  if (/\b(tax|irs|ein|1099|w-9|w9)\b/.test(t))
    return 'Tax or IRS matter — forward to accountant or respond by deadline; do not ignore';

  if (/\b(urgent|asap|immediately|time.sensitive)\b/.test(t))
    return 'Marked urgent — read now and respond or delegate today';
  if (/\b(please respond|response needed|awaiting your reply)\b/.test(t))
    return 'Response requested — reply, forward to the right person, or decline';
  if (/\b(approve|approval needed|review needed)\b/.test(t))
    return 'Approval needed — review and reply approve, reject, or request more info';

  return 'Review and reply, forward to the right person, or delete if not relevant';
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────
function makeOAuth2(refreshToken) {
  const c = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  c.setCredentials({ refresh_token: refreshToken });
  return c;
}

async function ensureGmailLabel(gmail, name) {
  const list = await gmail.users.labels.list({ userId: 'me' });
  const found = (list.data.labels || []).find((l) => l.name === name);
  if (found) return found.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return created.data.id;
}

async function batchModify(gmail, ids, addLabelIds, removeLabelIds) {
  for (let i = 0; i < ids.length; i += 1000) {
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids: ids.slice(i, i + 1000), addLabelIds, removeLabelIds },
    });
  }
}

/** Plain-text body from a Gmail payload, walking multipart trees. */
function gmailBodyText(payload) {
  if (!payload) return '';
  const chunks = [];
  const walk = (p) => {
    if (!p) return;
    const data = p.body && p.body.data;
    if (data && /^text\/(plain|html)/.test(p.mimeType || '')) {
      chunks.push(Buffer.from(data, 'base64').toString('utf8'));
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return chunks.join('\n').slice(0, 200000);
}

async function checkAndManageGmail({ label, tokenEnv }, dryRun) {
  const r = {
    account: label, action: [], notif: [], junk: [], unsorted: [], drafts: [],
    verified: [], errors: [], filed: 0, quarantined: 0, labeled_action: 0, truncated: false,
  };
  const token = process.env[tokenEnv];
  if (!token) { r.errors.push(`${tokenEnv} not set`); return r; }

  try {
    const auth  = makeOAuth2(token);
    const gmail = google.gmail({ version: 'v1', auth });

    const labelIds = {};
    try {
      // In a dry run the labels are only looked up, never created: an empty
      // mailbox should not acquire four new labels just because someone asked
      // what would happen.
      if (dryRun) {
        const existing = (await gmail.users.labels.list({ userId: 'me' })).data.labels || [];
        const byName = (n) => (existing.find((l) => l.name === n) || {}).id;
        labelIds.action = byName(GL.action); labelIds.notif = byName(GL.notif);
        labelIds.junk = byName(GL.junk); labelIds.unsorted = byName(GL.unsorted);
        throw { __skip: true };
      }
      labelIds.action   = await ensureGmailLabel(gmail, GL.action);
      labelIds.notif    = await ensureGmailLabel(gmail, GL.notif);
      labelIds.junk     = await ensureGmailLabel(gmail, GL.junk);
      labelIds.unsorted = await ensureGmailLabel(gmail, GL.unsorted);
    } catch (e) { if (!e.__skip) r.errors.push(`Label setup: ${e.message}`); }

    const buckets = { action: [], notif: [], junk: [], unsorted: [] };
    let pageToken;
    let fetched = 0;

    do {
      // No `is:unread`. The whole inbox is in scope — that is the backlog fix.
      // Mail already handled is excluded because handling it removed INBOX;
      // unsorted mail keeps INBOX, so it is excluded by its own label instead.
      const params = { userId: 'me', q: `in:inbox -label:"${GL.unsorted}"`, maxResults: 100 };
      if (pageToken) params.pageToken = pageToken;
      const list = await gmail.users.messages.list(params);

      for (const msg of list.data.messages || []) {
        if (fetched >= PER_MAILBOX_LIMIT) { r.truncated = true; break; }

        const d = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
        const h = (d.data.payload && d.data.payload.headers) || [];
        const from    = (h.find((x) => x.name === 'From')    || {}).value || '';
        const subject = (h.find((x) => x.name === 'Subject') || {}).value || '(no subject)';
        const cat = classify(from, subject);

        if (cat === 'action') {
          const body = gmailBodyText(d.data.payload);
          const decision = verifyDecision(from, subject, body);
          if (decision.ok) {
            try {
              const res = dryRun ? { status: 0 } : await followVerification(decision.url);
              r.verified.push({ from, subject, url: decision.url, status: res.status });
              // Verified successfully: it is settled, so it files as a
              // notification rather than sitting on Roy's action list.
              buckets.notif.push(msg.id);
              r.notif.push({ from, subject });
              fetched++;
              continue;
            } catch (e) {
              r.errors.push(`verify ${subject}: ${e.message}`);
            }
          } else if (/verif|confirm/i.test(subject)) {
            // Looked like a verification and was refused. Say why, in the brief.
            r.action.push({ from, subject, note: `NOT auto-clicked: ${decision.reason}` });
            buckets.action.push(msg.id);
            fetched++;
            continue;
          }
        }

        r[cat].push({ from, subject });
        buckets[cat].push(msg.id);
        fetched++;
      }

      pageToken = list.data.nextPageToken;
    } while (pageToken && fetched < PER_MAILBOX_LIMIT);

    // Stopping because the budget ran out, with pages still unread, is a
    // truncated sweep. The in-loop check only fires when a page is cut in half;
    // a page that ends exactly ON the limit exits the while condition instead
    // and would otherwise report as a completed sweep. That is the same silent
    // cap this rewrite set out to remove, so it is caught here too.
    if (pageToken && fetched >= PER_MAILBOX_LIMIT) r.truncated = true;

    if (buckets.notif.length && (labelIds.notif || dryRun)) {
      if (!dryRun) await batchModify(gmail, buckets.notif, [labelIds.notif], ['INBOX']);
      r.filed = buckets.notif.length;
    }
    if (buckets.junk.length && (labelIds.junk || dryRun)) {
      if (!dryRun) await batchModify(gmail, buckets.junk, [labelIds.junk], ['INBOX']);
      r.quarantined = buckets.junk.length;
    }
    if (buckets.action.length && (labelIds.action || dryRun)) {
      // Moved out of the inbox into Action-Required, so the inbox holds only
      // what Javari could not name and the next run cannot re-handle these.
      if (!dryRun) await batchModify(gmail, buckets.action, [labelIds.action], ['INBOX']);
      r.labeled_action = buckets.action.length;
    }
    if (buckets.unsorted.length && labelIds.unsorted && !dryRun) {
      // Tagged, NOT moved. It stays in the inbox where Roy will see it.
      await batchModify(gmail, buckets.unsorted, [labelIds.unsorted], []);
    }

    const drafts = await gmail.users.drafts.list({ userId: 'me', maxResults: 50 });
    const cutoff = Date.now() - 7 * 86400000;
    for (const d of drafts.data.drafts || []) {
      const full = await gmail.users.drafts.get({
        userId: 'me', id: d.id, format: 'metadata', metadataHeaders: ['Subject'],
      });
      const ts = parseInt((full.data.message && full.data.message.internalDate) || '0', 10);
      if (ts < cutoff) {
        const hh = (full.data.message && full.data.message.payload && full.data.message.payload.headers) || [];
        const subject = (hh.find((x) => x.name === 'Subject') || {}).value || '(no subject)';
        r.drafts.push({ subject, age: `${Math.floor((Date.now() - ts) / 86400000)}d` });
      }
    }
  } catch (err) { r.errors.push(err.message); }
  return r;
}

// ── Microsoft Graph helpers ───────────────────────────────────────────────────
async function getGraphToken() {
  const res = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.AZURE_CLIENT_ID,
      client_secret: process.env.AZURE_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Graph token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gGet(token, path) {
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph GET ${path}: ${res.status}`);
  return res.json();
}

async function gPost(token, path, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Graph POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Move many messages with Graph's $batch endpoint, 20 per request.
 *
 * One-at-a-time moves were the previous version's real performance problem:
 * accounts@ files around 456 messages a day, and 456 sequential round trips is
 * minutes of wall clock against a function timeout. Returns how many moved.
 */
async function graphMoveBatch(token, userId, messageIds, destinationId) {
  let moved = 0;
  const errors = [];
  for (let i = 0; i < messageIds.length; i += 20) {
    const slice = messageIds.slice(i, i + 20);
    const body = {
      requests: slice.map((id, n) => ({
        id: String(n + 1),
        method: 'POST',
        url: `/users/${userId}/messages/${id}/move`,
        headers: { 'Content-Type': 'application/json' },
        body: { destinationId },
      })),
    };
    const res = await fetch('https://graph.microsoft.com/v1.0/$batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { errors.push(`$batch ${res.status}`); continue; }
    const out = await res.json();
    for (const rr of out.responses || []) {
      if (rr.status >= 200 && rr.status < 300) moved++;
      else errors.push(`move ${rr.status}`);
    }
  }
  return { moved, errors };
}

async function ensureM365Folder(token, userId, displayName) {
  const data = await gGet(token, `/users/${userId}/mailFolders?$filter=displayName eq '${displayName}'&$top=1`);
  if (data.value && data.value.length > 0) return data.value[0].id;
  const created = await gPost(token, `/users/${userId}/mailFolders`, { displayName });
  return created.id;
}

async function checkAndManageM365(token, dryRun) {
  let users = [];
  try {
    const data = await gGet(token, '/users?$select=id,mail,userPrincipalName,displayName&$top=100');
    users = (data.value || []).filter((u) =>
      (u.mail || u.userPrincipalName || '').toLowerCase().endsWith('@craudiovizai.com'));
  } catch (err) {
    return [{
      account: '@craudiovizai.com (discovery failed)', action: [], notif: [], junk: [],
      unsorted: [], drafts: [], verified: [], errors: [err.message],
      filed: 0, quarantined: 0, labeled_action: 0, truncated: false,
    }];
  }

  const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const results = [];

  for (const user of users) {
    const addr = user.mail || user.userPrincipalName;
    const r = {
      account: addr, action: [], notif: [], junk: [], unsorted: [], drafts: [],
      verified: [], errors: [], filed: 0, quarantined: 0, labeled_action: 0, truncated: false,
    };

    try {
      const folderIds = {};
      try {
        if (dryRun) throw { __skip: true };
        folderIds.action = await ensureM365Folder(token, user.id, MF.action);
        folderIds.notif  = await ensureM365Folder(token, user.id, MF.notif);
        folderIds.junk   = await ensureM365Folder(token, user.id, MF.junk);
      } catch (e) { if (!e.__skip) r.errors.push(`Folder setup: ${e.message}`); }

      // No isRead filter — the whole inbox. Handled mail leaves the inbox, so
      // this stays idempotent without one.
      let nextLink = `/users/${user.id}/mailFolders/inbox/messages?$select=id,from,subject,bodyPreview&$top=100`;
      let fetched = 0;
      const ids = { action: [], notif: [], junk: [] };

      while (nextLink && fetched < PER_MAILBOX_LIMIT) {
        const inbox = await gGet(token, nextLink);
        for (const msg of inbox.value || []) {
          if (fetched >= PER_MAILBOX_LIMIT) { r.truncated = true; break; }
          const from    = (msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '';
          const subject = msg.subject || '(no subject)';
          const cat = classify(from, subject);

          if (cat === 'action') {
            const decision = verifyDecision(from, subject, msg.bodyPreview || '');
            if (decision.ok) {
              try {
                const vres = dryRun ? { status: 0 } : await followVerification(decision.url);
                r.verified.push({ from, subject, url: decision.url, status: vres.status });
                r.notif.push({ from, subject });
                ids.notif.push(msg.id);
                fetched++;
                continue;
              } catch (e) { r.errors.push(`verify ${subject}: ${e.message}`); }
            } else if (/verif|confirm/i.test(subject)) {
              r.action.push({ from, subject, note: `NOT auto-clicked: ${decision.reason}` });
              ids.action.push(msg.id);
              fetched++;
              continue;
            }
          }

          r[cat].push({ from, subject });
          if (cat !== 'unsorted') ids[cat].push(msg.id);
          fetched++;
        }
        nextLink = inbox['@odata.nextLink'] || null;
      }
      // Same boundary case as Gmail above: a page ending exactly on the limit
      // exits the while condition without tripping the in-loop flag.
      if (nextLink && fetched >= PER_MAILBOX_LIMIT) r.truncated = true;

      if (dryRun) {
        r.filed = ids.notif.length;
        r.quarantined = ids.junk.length;
        r.labeled_action = ids.action.length;
      } else {
        if (folderIds.notif && ids.notif.length) {
          const out = await graphMoveBatch(token, user.id, ids.notif, folderIds.notif);
          r.filed = out.moved; out.errors.slice(0, 3).forEach((e) => r.errors.push(`notif ${e}`));
        }
        if (folderIds.junk && ids.junk.length) {
          const out = await graphMoveBatch(token, user.id, ids.junk, folderIds.junk);
          r.quarantined = out.moved; out.errors.slice(0, 3).forEach((e) => r.errors.push(`junk ${e}`));
        }
        if (folderIds.action && ids.action.length) {
          const out = await graphMoveBatch(token, user.id, ids.action, folderIds.action);
          r.labeled_action = out.moved; out.errors.slice(0, 3).forEach((e) => r.errors.push(`action ${e}`));
        }
      }
      // Unsorted is deliberately not moved.

      const dr = await gGet(token, `/users/${user.id}/mailFolders/drafts/messages?$filter=lastModifiedDateTime le ${cutoff7d}&$select=subject,lastModifiedDateTime&$top=20`);
      for (const d of dr.value || []) {
        const age = Math.floor((Date.now() - new Date(d.lastModifiedDateTime).getTime()) / 86400000);
        r.drafts.push({ subject: d.subject || '(no subject)', age: `${age}d` });
      }
    } catch (err) { r.errors.push(err.message); }
    results.push(r);
  }
  return results;
}

// ── Brief assembly + delivery ─────────────────────────────────────────────────

/**
 * RFC 2047 encode a header value that may contain non-ASCII.
 *
 * Mail headers are 7-bit. The previous version put a raw emoji straight into
 * Subject:, which is why every digest arrived titled "Ã°ÂŸÂ—Â‚Ã¯Â¸Â Javari
 * filed 536" instead of "🗂️ Javari filed 536".
 */
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

async function deliverBrief(all, dryRun) {
  const etDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const etNow = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

  let tAction = 0, tNotif = 0, tJunk = 0, tDraft = 0, tErr = 0;
  let tFiled = 0, tQuar = 0, tUnsorted = 0, tVerified = 0, tTrunc = 0;
  const lines = [`JAVARI EMAIL MANAGER — ${etDate}`, '='.repeat(64), ''];

  for (const r of all) {
    const a = r.action.length, n = r.notif.length, j = r.junk.length;
    const u = (r.unsorted || []).length, d = r.drafts.length, e = r.errors.length;
    const v = (r.verified || []).length;
    tAction += a; tNotif += n; tJunk += j; tDraft += d; tErr += e;
    tUnsorted += u; tVerified += v;
    tFiled += (r.filed || 0); tQuar += (r.quarantined || 0);
    if (r.truncated) tTrunc++;

    lines.push(`📬 ${r.account}`);
    lines.push(`   Javari filed: ${r.filed || 0} notifications | ${r.quarantined || 0} junk quarantined | ${a} actions need YOU`);
    if (u > 0) lines.push(`   ${u} left in your inbox — Javari could not classify ${u !== 1 ? 'them' : 'it'} and did not move ${u !== 1 ? 'them' : 'it'}`);

    if (v > 0) {
      lines.push('  ✅ VERIFIED FOR YOU — links followed automatically:');
      r.verified.forEach((m) => {
        lines.push(`    • ${m.subject}`);
        lines.push(`      From: ${m.from} — HTTP ${m.status}`);
      });
    }
    if (a > 0) {
      lines.push('  ⚡ ACTION REQUIRED — each one needs your decision:');
      r.action.forEach((m, i) => {
        lines.push(`    ${i + 1}. ${m.subject}`);
        lines.push(`       From: ${m.from}`);
        if (m.note) lines.push(`       ⚠ ${m.note}`);
        lines.push(`       → ${suggestFollowUp(m.from, m.subject)}`);
      });
    }
    if (u > 0) {
      lines.push(`  📥 UNSORTED — still in your inbox, nothing was moved:`);
      r.unsorted.slice(0, 25).forEach((m) => lines.push(`    • ${m.subject}  — ${m.from}`));
      if (u > 25) lines.push(`    …and ${u - 25} more`);
    }
    if (j > 0) {
      lines.push(`  🚫 JUNK QUARANTINED — ${j} item${j !== 1 ? 's' : ''} in Junk-Review (safe to bulk delete, nothing auto-deleted):`);
      r.junk.slice(0, 25).forEach((m) => lines.push(`    • ${m.subject}`));
      if (j > 25) lines.push(`    …and ${j - 25} more`);
    }
    if (d > 0) {
      lines.push(`  📝 FORGOTTEN DRAFTS — did you mean to send ${d !== 1 ? 'these' : 'this'}?`);
      r.drafts.forEach((m) => lines.push(`    • "${m.subject}" — unsent for ${m.age}`));
    }
    if (r.truncated) {
      lines.push(`  ⏳ HIT THE ${PER_MAILBOX_LIMIT}-MESSAGE LIMIT for this run — more remains, next run continues.`);
    }
    if (e > 0) {
      lines.push('  ❌ ERRORS:');
      r.errors.slice(0, 8).forEach((x) => lines.push(`    • ${x}`));
    }
    lines.push('');
  }

  lines.push('='.repeat(64));
  lines.push(`JAVARI HANDLED:  ${tFiled} notifications filed | ${tQuar} junk quarantined | ${tVerified} verified automatically`);
  lines.push(`YOUR INBOX:      ${tAction} action item${tAction !== 1 ? 's' : ''} need your decisions | ${tUnsorted} unsorted | ${tDraft} forgotten draft${tDraft !== 1 ? 's' : ''}`);
  if (tTrunc > 0) lines.push(`NOT FINISHED:    ${tTrunc} mailbox${tTrunc !== 1 ? 'es' : ''} hit the per-run limit — backlog still clearing`);
  if (tErr > 0) lines.push(`Errors: ${tErr} — check account details above`);
  lines.push(`Generated ${etNow} ET by Javari AI`);

  const briefText = lines.join('\n');

  if (dryRun) {
    return { tAction, tNotif, tJunk, tDraft, tErr, tFiled, tQuar, tUnsorted, tVerified, tTrunc, briefText, dryRun: true };
  }

  const auth = makeOAuth2(process.env.GMAIL_REFRESH_TOKEN_CRAUDIOVIZAI);
  const gmail = google.gmail({ version: 'v1', auth });
  const stamp = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const subjectLine = `🗂️ Javari filed ${tFiled} | ${tAction} action${tAction !== 1 ? 's' : ''} need you | ${stamp}`;

  const raw = [
    `To: ${BRIEF_TO}`,
    `From: ${encodeHeader('Javari Email Manager')} <${BRIEF_FROM}>`,
    `Subject: ${encodeHeader(subjectLine)}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    briefText,
  ].join('\r\n');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(raw, 'utf8').toString('base64url') },
  });

  const supabase = createClient(
    process.env.SUPABASE_URL || 'https://kteobfyferrukqeolofj.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('javari_morning_brief').upsert(
    {
      brief_date: today,
      action_required_count: tAction,
      notification_count: tNotif,
      junk_count: tJunk,
      draft_count: tDraft,
      error_count: tErr,
      brief_text: briefText,
      notified: true,
    },
    { onConflict: 'brief_date' },
  );

  return { tAction, tNotif, tJunk, tDraft, tErr, tFiled, tQuar, tUnsorted, tVerified, tTrunc };
}

// ── Vercel handler ────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const dryRun = req.query && (req.query.dryRun === '1' || req.query.dryRun === 'true');
  const log = [];
  const t0 = Date.now();
  try {
    log.push(`[START] Javari Email Manager — ${dryRun ? 'DRY RUN (nothing will be changed)' : 'active management run'}`);

    const all = [];

    for (const acct of GMAIL_ACCOUNTS) {
      log.push(`[GMAIL] ${acct.label}`);
      const r = await checkAndManageGmail(acct, dryRun);
      all.push(r);
      log.push(`  → filed:${r.filed} quarantined:${r.quarantined} action:${r.action.length} unsorted:${r.unsorted.length} verified:${r.verified.length} err:${r.errors.length}`);
    }

    if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
      log.push('[M365] Getting Graph token');
      const token = await getGraphToken();
      const m365 = await checkAndManageM365(token, dryRun);
      all.push(...m365);
      log.push(`[M365] ${m365.length} mailboxes managed`);
    } else {
      log.push('[M365] SKIP — Azure creds not set');
    }

    log.push('[BRIEF] Assembling and delivering');
    const summary = await deliverBrief(all, dryRun);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log.push(`[DONE] ${elapsed}s — filed:${summary.tFiled} quarantined:${summary.tQuar} action:${summary.tAction} unsorted:${summary.tUnsorted} verified:${summary.tVerified}`);

    return res.status(200).json({ ok: true, dryRun, summary, elapsed, log });
  } catch (err) {
    log.push(`[FATAL] ${err.message}`);
    console.error('[email-brief]', err);
    return res.status(500).json({
      ok: false, error: err.message, elapsed: ((Date.now() - t0) / 1000).toFixed(2), log,
    });
  }
};
