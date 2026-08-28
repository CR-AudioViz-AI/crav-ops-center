// email-manager/lib/thread-state.js
//
// Answer one question about a message, cheaply: are we in this conversation,
// and if so, is it waiting on us?
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY IT IS SHAPED LIKE THIS
//
// The naive way to know whether we ever replied to a thread is to fetch the
// thread. Do that for every message in a 15,000-message sweep across fourteen
// mailboxes and the run does not finish.
//
// The cheap way is to invert it. We do not need to know about every thread —
// only about the ones we have EVER SENT INTO, and that set is small, bounded,
// and can be fetched once per mailbox before the sweep starts:
//
//     read Sent once  ->  { threadId -> when we last spoke }
//
// Then every inbox message answers both questions by a map lookup:
//
//     weSent          = map.has(threadId)
//     newestIsInbound = message is newer than our last word in that thread
//
// Two facts, no per-message network call, and it works identically for Gmail
// (threadId) and Microsoft Graph (conversationId).
//
// The one place a real fetch happens is Gmail threads we are in AND that look
// closed — a few dozen at most — because "your ticket has been set as solved"
// can arrive on a message we never see if it is not the newest.
//
// CR AudioViz AI, LLC · EIN 39-3646201 · 2026-08-27

'use strict';

// How far back to read Sent. A thread we last spoke in over a year ago is not
// a live conversation, and reading further costs pages for nothing.
const SENT_LOOKBACK_DAYS = 365;

// Cap on how much Sent we will read per mailbox. A sweep must end.
const SENT_MAX = 2000;

/**
 * Gmail: { threadId -> epoch ms of our most recent message in that thread }.
 *
 * Uses threads.list rather than messages.list: one row per thread instead of
 * one per message, so a long support thread costs one entry, not thirty. The
 * date comes from the thread's own most recent message, which for a thread in
 * SENT is the right anchor — if they had replied more recently the message we
 * are testing would be newer than it, which is exactly the comparison we want.
 */
async function gmailSentThreads(gmail) {
  const map = new Map();
  let pageToken;
  let seen = 0;
  do {
    const params = {
      userId: 'me',
      q: `in:sent newer_than:${SENT_LOOKBACK_DAYS}d`,
      maxResults: 100,
    };
    if (pageToken) params.pageToken = pageToken;
    const list = await gmail.users.threads.list(params);
    for (const th of list.data.threads || []) {
      if (seen >= SENT_MAX) break;
      // threads.list gives id and a snippet but no date. Rather than fetch each
      // thread, record presence now and resolve the date lazily only for the
      // threads that actually turn up in the inbox — usually a handful.
      if (!map.has(th.id)) map.set(th.id, null);
      seen++;
    }
    pageToken = list.data.nextPageToken;
  } while (pageToken && seen < SENT_MAX);
  return map;
}

/**
 * Resolve one Gmail thread: when did we last speak, is the newest message
 * theirs, and did anyone close it.
 *
 * Called only for threads that appear in BOTH sent and inbox. Everything else
 * never reaches here.
 */
async function gmailThreadDetail(gmail, threadId, rxClosed) {
  const th = await gmail.users.threads.get({
    userId: 'me', id: threadId, format: 'metadata',
    metadataHeaders: ['Subject'],
  });
  const msgs = (th.data.messages || []).slice().sort(
    (a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
  if (!msgs.length) return { weSent: false, newestIsInbound: true, closed: false };

  const isOurs = (m) => (m.labelIds || []).includes('SENT');
  const newest = msgs[msgs.length - 1];
  const ourLast = [...msgs].reverse().find(isOurs);

  // A closing marker anywhere in the thread ends it, not only on the newest
  // message. "Set as solved" is frequently followed by a satisfaction survey.
  const closed = msgs.some((m) => {
    const h = (m.payload && m.payload.headers) || [];
    const s = (h.find((x) => x.name === 'Subject') || {}).value || '';
    return rxClosed.test(s);
  });

  return {
    weSent: Boolean(ourLast),
    newestIsInbound: !isOurs(newest),
    ourLastDate: ourLast ? new Date(Number(ourLast.internalDate)).toISOString() : null,
    closed,
  };
}

/**
 * Microsoft Graph: { conversationId -> ISO of our most recent message in it }.
 *
 * Graph makes this cheaper than Gmail does — Sent Items carries conversationId
 * and sentDateTime on the list response itself, so the whole map is built from
 * paged list calls with no per-item fetch at all.
 *
 * @param {function} gGet  the caller's authenticated GET helper
 */
async function graphSentConversations(gGet, userId) {
  const map = new Map();
  const since = new Date(Date.now() - SENT_LOOKBACK_DAYS * 86400000).toISOString();
  let next = `/users/${userId}/mailFolders/sentitems/messages`
           + `?$select=conversationId,sentDateTime`
           + `&$filter=sentDateTime ge ${since}`
           + '&$top=200';
  let seen = 0;
  while (next && seen < SENT_MAX) {
    const page = await gGet(next);
    for (const m of page.value || []) {
      seen++;
      const c = m.conversationId;
      if (!c) continue;
      const prev = map.get(c);
      if (!prev || m.sentDateTime > prev) map.set(c, m.sentDateTime);
    }
    next = page['@odata.nextLink'] || null;
  }
  return map;
}

/**
 * Turn a Graph inbox message plus the sent map into the shape triage() wants.
 * Pure function — no network, so the tests exercise the real logic.
 */
function graphThreadState(msg, sentMap, rxClosed) {
  const conv = msg.conversationId;
  const ourLastDate = conv ? sentMap.get(conv) : undefined;
  if (!ourLastDate) {
    return { weSent: false, newestIsInbound: true, ourLastDate: null, closed: false };
  }
  const received = msg.receivedDateTime || '';
  return {
    weSent: true,
    // String compare is correct here: both are ISO 8601 UTC from Graph, and
    // ISO 8601 sorts lexicographically. Parsing them would be slower and no
    // more accurate.
    newestIsInbound: received > ourLastDate,
    ourLastDate,
    closed: rxClosed.test(msg.subject || ''),
  };
}

/** Pull one header out of a Gmail metadata payload, case-insensitively. */
function gmailHeader(payload, name) {
  const hs = (payload && payload.headers) || [];
  const want = name.toLowerCase();
  const hit = hs.find((h) => (h.name || '').toLowerCase() === want);
  return hit ? hit.value : undefined;
}

/**
 * Pull one RFC 822 header out of a Graph message.
 *
 * Graph exposes these two different ways and the caller may have used either:
 *
 *   internetMessageHeaders          only available on a SINGLE message GET
 *   singleValueExtendedProperties   available on a COLLECTION, via the MAPI
 *                                   named property PS_INTERNET_HEADERS
 *
 * The sweep uses the second, because the first would cost one HTTP call per
 * message. This reads whichever is present so a single-message caller and the
 * sweep can share one code path.
 *
 * Extended-property ids come back as "String {GUID} Name List-Unsubscribe",
 * so the header name is matched at the end of the id rather than by equality.
 */
function graphHeader(msg, name) {
  const want = name.toLowerCase();

  const direct = (msg.internetMessageHeaders || [])
    .find((h) => (h.name || '').toLowerCase() === want);
  if (direct) return direct.value;

  const ext = (msg.singleValueExtendedProperties || [])
    .find((p) => String(p.id || '').toLowerCase().endsWith(`name ${want}`));
  return ext ? ext.value : undefined;
}

module.exports = {
  gmailSentThreads, gmailThreadDetail,
  graphSentConversations, graphThreadState,
  gmailHeader, graphHeader,
  SENT_LOOKBACK_DAYS, SENT_MAX,
};
