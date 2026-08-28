// email-manager/lib/triage.js
//
// Decide what a message IS, from what is true about it — not from what its
// subject line says.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS REPLACES classify()
//
// Every previous version asked "is this a notification or an action?" That
// question has no answer, because the same address sends both. Akool sends
// marketing and answers a $252 refund. StackBlitz sends onboarding drip with a
// fake "Re:" prefix from the address that also answers real tickets. No subject
// line separates them, so every rule written against subject lines eventually
// gets one of them wrong, and the fix has always been to add another rule.
//
// That produced a 242-entry hand-built list of senders. A list is obsolete the
// moment vendor 243 writes, and maintaining it is manual labour wearing the
// costume of automation.
//
// The question that DOES have an answer is:
//
//     Is something still open, and is Roy the only one who can close it?
//
// That is answerable from facts the mail servers already hold, and it does not
// care whether we have ever seen the sender before.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO SIGNALS THAT DO THE WORK
//
// 1. THREAD STATE. Gmail gives every message a threadId; Graph gives a
//    conversationId. If anyone at CR AudioViz ever sent into that thread, it is
//    a conversation we are in. If the newest message is inbound and we have not
//    answered it, it is waiting on us. Nothing else in a mailbox is as
//    decisive, and no previous version fetched it.
//
//    This alone resolves the StackBlitz problem that was previously written off
//    as unsolvable: "Re: How is your first week with Bolt.new?" is bulk mail
//    because we never sent into that thread. "Re: Billed twice for a total over
//    $900" is a conversation because we opened it.
//
// 2. List-Unsubscribe. RFC 2369. A bulk sender is legally and practically
//    obliged to include it; a human writing to you does not have one. It is the
//    single most reliable "this is a broadcast" signal in existence, it is
//    present on mail from senders nobody has ever catalogued, and it costs one
//    extra header on a fetch we were already making.
//
// Between them these two facts classify the large majority of any mailbox
// without knowing one thing about the sender. What is left over is small enough
// to hand to a model.
//
// ─────────────────────────────────────────────────────────────────────────────
// BUCKETS, and what each one means to Roy
//
//   waiting      Someone is blocked on Roy specifically. This is the only
//                bucket that costs him attention, and it is kept small on
//                purpose — everything here should be something only he can do.
//   opportunity  An inbound offer. Real value, but a decision that batches:
//                129 affiliate invitations are one decision made 129 times.
//   record       Happened, is finished, keep it: receipts, confirmations,
//                codes, resolved tickets, status notices.
//   broadcast    Sent to a list. Marketing, newsletters, product news.
//   declined     An application or partnership rejected. A record with a
//                different shape: worth finding later, never worth a decision.
//   junk         Fraud. Quarantined, never deleted.
//   unsorted     Refused. Stays in the inbox. Still the honest answer when
//                nothing above is true and the model was not available.
//
// CR AudioViz AI, LLC · EIN 39-3646201 · 2026-08-27

'use strict';

// A thread we sent into, that has gone quiet on their side, is not urgent
// forever. Past this many days it becomes a record — it can still be searched,
// it just stops occupying attention every morning. Chosen because a vendor who
// has not followed up in six weeks is not waiting on us any more.
const STALE_DAYS = 45;

// Money and safety outrank every other rule here, including thread state. A
// failed charge is an action even if it arrived from a no-reply address in a
// thread we were never part of.
const RX_MONEY_AT_RISK = new RegExp([
  // The period class matters: the text between "payment" and "unsuccessful" is
  // nearly always a company name or an amount, and both contain periods.
  //     "$465.56 payment to Base44, Inc. was unsuccessful again"
  '\\b(payment|card|charge|transaction|billing|invoice|subscription|autopay)\\b',
  '[^\\n]{0,60}\\b(declined|failed|denied|unsuccessful|could not be processed)\\w*\\b',
].join(''), 'i');

const RX_URGENT = /\b(overdue|past due|final notice|final demand|suspended|account (is )?locked|payment due|amount due|failed payment|payment failed|expires? (today|tomorrow)|(final|last) chance to renew|will be (deleted|terminated|cancelled|canceled))\w*\b/i;

// A credential in the open is the most expensive mail in any inbox and the
// least likely to look urgent. GitGuardian's alert sat unread for a week.
const RX_SECURITY = /\b(secret|token|api key|credential|password|private key)s?\b[^\n]{0,40}\b(exposed|leaked|committed|found|detected|compromised)\w*\b|\b(security (alert|incident|breach)|unauthori[sz]ed access|data breach)\w*\b/i;

// A partnership or application rejection. A record, not a decision — Roy asked
// for these to be searchable rather than to sit in an action list. It must be
// tested AFTER the money rule, because "your payment was declined" is a failed
// charge wearing the same word.
const RX_DECLINED = /\b(declined|not approved|was rejected|unable to approve|did not meet|not be moving forward|unsuccessful application)\w*\b/i;
const RX_DECLINE_CONTEXT = /\b(application|apply|partnership|affiliate|program|request|publisher|partner)\w*\b/i;

// The manager's own daily brief. Without this it reappears in its own unsorted
// list every morning, forever.
const RX_SELF = /craudiovizai@gmail\.com/i;

const RX_JUNK = /\b(casino|lottery|you have won|prize claim|million dollars|unclaimed funds|investment opportunity|click here now|make money fast|double your|work from home)\w*\b/i;

// NOTE ON THE TRAILING \w*\b — applies to every pattern in this file, above
// and below.
//
// Every multi-word pattern here ends `\w*\b` rather than plain `\b`. A bare
// boundary after an alternation group breaks the moment the matched word takes
// a suffix, and it does so silently:
//
//     /\b(final notice|...)\b/    matches "final notice"
//                                   MISSES  "final notices"
//     /\b(...|partner)\b/         MISSES  "Partnership"
//     /\b(security breach)\b/     MISSES  "security breaches"
//
// That last one is not hypothetical — it would have dropped a security alert.
// The `\w*` lets the word finish; the leading `\b` still anchors the start, so
// nothing matches mid-word.
//
// A thread that has been closed by the other side is finished. "Your ticket has
// been set as solved" is not an action item, and treating it as one is how an
// action list grows to 75 entries and stops being read.
const RX_CLOSED = /\b(has been (set as )?(solved|resolved|closed)|marked as (solved|resolved)|ticket closed|case closed|incident .{0,20}was closed|this (ticket|case) is now closed|no further action)\w*\b/i;

// An inbound offer: someone wants to work with us. Distinct from an action
// because it batches — see the opportunity digest.
//
// No trailing \b on the alternation. An earlier version ended the whole group
// with one, which silently broke every alternative whose last word can take a
// suffix: "let's explore a partner" matched, "Let's Explore a Partnership" did
// not, because the boundary landed between "partner" and "ship". Each branch
// now carries whatever ending it actually needs.
const RX_OPPORTUNITY = new RegExp([
  '\\bhas invited you to join',
  '\\binvited you to (their|our) programme?\\b',
  '\\binvitation to (join|partner)',
  '\\bcollaboration invitation\\b',
  '\\bpartnership (request|proposal|opportunit)',
  "\\blet'?s (explore an? )?partner",
  '\\bpromote [^\\n]{0,30} on your (platform|site|blog)\\b',
  '\\baffiliate program(me)?\\b[^\\n]{0,40}\\b(welcome|invitation|approved|accepted)\\b',
  '\\bwelcome to (the )?[^\\n]{0,40}(affiliate|partner|publisher|ambassador) program',
].join('|'), 'i');

// Machine-generated statements of fact. Deliberately narrow: each of these is a
// thing that already happened and cannot be argued with.
const RX_RECORD = /\b(your receipt|receipt from|invoice #|payment (received|successful|confirmed)|order (#|confirmed|received)|has shipped|shipping confirmation|verification code|one.?time (code|password|passcode)|confirm your (e-?mail|subscription|registration)|welcome to|your account (is ready|has been created|was created)|password (was )?changed|new (device|login|sign.?in)|two.?factor|backup (completed|successful)|monthly (report|statement|summary)|weekly digest)\w*\b/i;

/** Bare address out of "Display Name <a@b>", or a bare address unchanged. */
function addressOf(from) {
  const m = /<([^>]+)>/.exec(from || '');
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

function domainOf(from) {
  const a = addressOf(from);
  const i = a.lastIndexOf('@');
  return i === -1 ? '' : a.slice(i + 1);
}

function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86400000;
}

/**
 * Decide one message.
 *
 * @param {object} m
 *   from, subject            the two headers we always have
 *   date                     ISO string, newest message in the thread
 *   listUnsubscribe          the List-Unsubscribe header value, if present
 *   autoSubmitted            the Auto-Submitted header value, if present
 *   precedence              the Precedence header value, if present
 * @param {object} thread
 *   weSent                   did anyone on our side ever send into this thread
 *   newestIsInbound          is the most recent message in the thread theirs
 *   ourLastDate              ISO of our most recent message in the thread
 *   closed                   did a closing marker appear in the thread
 * @param {Map}   reputation  address -> bucket, learned. May be empty.
 *
 * @returns {{bucket:string, reason:string, source:string, needsModel:boolean}}
 *   `needsModel` true means: nothing here was decisive, ask the model. The
 *   caller decides whether to; if it cannot, the bucket returned is 'unsorted'
 *   and the message stays in the inbox. Refusing is always available.
 */
function triage(m = {}, thread = {}, reputation = new Map()) {
  const from = m.from || '';
  const subject = m.subject || '';
  const t = `${from} ${subject}`;
  const addr = addressOf(from);

  const R = (bucket, reason, source = 'rule') =>
    ({ bucket, reason, source, needsModel: false });


  // ── 1. Fraud. Quarantined, never deleted. ────────────────────────────────
  if (RX_JUNK.test(t)) return R('junk', 'fraud language in subject or sender');

  // ── 2. Money and safety. These outrank thread state deliberately. ────────
  if (RX_SECURITY.test(t)) {
    return R('waiting', 'security alert — a credential may be exposed');
  }
  if (RX_MONEY_AT_RISK.test(t)) {
    return R('waiting', 'a payment failed — money is at risk');
  }
  if (RX_URGENT.test(subject)) {
    return R('waiting', 'a deadline or suspension is stated in the subject');
  }

  // ── 2b. Rejections and our own digest. ───────────────────────────────────
  //
  // Both sit above thread state deliberately. A decline inside a thread we
  // opened is still a record — the conversation is over, and the answer was no.
  if (RX_DECLINED.test(subject) && RX_DECLINE_CONTEXT.test(t)) {
    return R('declined', 'an application or partnership was rejected');
  }
  if (RX_SELF.test(from)) {
    return R('record', "the manager's own brief, filing itself");
  }

  // ── 3. Thread state. The signal no earlier version used. ─────────────────
  //
  // Order inside this block matters. A closed thread is finished even though
  // we are in it; an open thread waiting on us is the definition of an action.
  if (thread.weSent) {
    if (thread.closed || RX_CLOSED.test(subject)) {
      return R('record', 'a conversation we were in, now closed by them');
    }
    if (!thread.newestIsInbound) {
      return R('record', 'we spoke last — the ball is on their side');
    }
    const age = daysSince(m.date);
    if (age !== null && age > STALE_DAYS) {
      return R('record',
        `a conversation that went quiet ${Math.round(age)} days ago`);
    }
    return R('waiting', 'they replied to a thread we started and we have not answered');
  }

  // ── 4. Inbound offers. Real value, but they batch. ───────────────────────
  if (RX_OPPORTUNITY.test(subject)) {
    return R('opportunity', 'an inbound offer to work with us');
  }

  // ── 5. Bulk mail, proven by its own headers. ─────────────────────────────
  //
  // RFC 2369: a sender running a list includes List-Unsubscribe. A person
  // writing to you does not. This is why the system does not need to have
  // heard of the sender — the sender declares itself.
  //
  // It sits AFTER thread state on purpose: a vendor's ticketing system can
  // carry these headers while genuinely answering our question.
  if (m.listUnsubscribe) {
    return R('broadcast', 'sender declared a mailing list (List-Unsubscribe)');
  }
  if (/^auto-(generated|replied|notified)$/i.test(m.autoSubmitted || '')) {
    return R('record', 'sender declared the message auto-generated');
  }
  if (/^(bulk|list|junk)$/i.test(m.precedence || '')) {
    return R('broadcast', 'sender declared bulk precedence');
  }

  // ── 6. What we have learned about this sender. ───────────────────────────
  //
  // Learned, not listed. This map is written by observing Roy — a sender he
  // replies to is a person, a sender he never opens is noise — and it grows
  // without anyone editing a file.
  const learned = reputation.get(addr) || reputation.get('@' + domainOf(from));
  if (learned && learned !== 'unsorted') {
    // A sender known to be a support channel is NOT a standing action.
    //
    // Measured on the live mailboxes: 39 of 50 raised actions came from this
    // lookup and only 6 from real thread state, because much vendor support
    // happens in a web portal and never becomes an email thread we can see.
    // The reputation is still right — Base44 IS where a $900 dispute lives —
    // but "this sender is a support channel" is not the same claim as "this
    // message is open".
    //
    // So a reputation of 'waiting' is treated as a CANDIDATE and has to
    // survive the same two tests a real thread does: not closed, not stale.
    // Without this the action list silently refills with resolved tickets and
    // stops being read, which is the failure this whole rewrite is about.
    if (learned === 'waiting') {
      if (RX_CLOSED.test(subject)) {
        return R('record', 'a support channel, but this one is closed', 'reputation');
      }
      const age = daysSince(m.date);
      if (age !== null && age > STALE_DAYS) {
        return R('record',
          `a support channel, but silent for ${Math.round(age)} days`, 'reputation');
      }
    }
    return { bucket: learned, reason: 'learned from how Roy treats this sender',
             source: 'reputation', needsModel: false };
  }

  // ── 7. Statements of fact. ───────────────────────────────────────────────
  if (RX_RECORD.test(subject)) {
    return R('record', 'a confirmation of something that already happened');
  }

  // ── 8. Out of facts. Ask the model, and refuse if it is not there. ───────
  return {
    bucket: 'unsorted',
    reason: 'no decisive signal — first time seeing this sender, not a thread ' +
            'we are in, and no bulk headers',
    source: 'refused',
    needsModel: true,
  };
}

module.exports = {
  triage, addressOf, domainOf, daysSince, STALE_DAYS,
  // Exported so the test can assert against the same patterns the engine uses,
  // rather than a copy that can drift away from it.
  RX: { RX_JUNK, RX_SECURITY, RX_MONEY_AT_RISK, RX_URGENT, RX_CLOSED,
        RX_OPPORTUNITY, RX_RECORD, RX_DECLINED, RX_DECLINE_CONTEXT, RX_SELF },
};
