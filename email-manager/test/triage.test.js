// email-manager/test/triage.test.js
//
// Offline test for the triage engine. No mailbox, no network, no credentials.
//
// The cases below are real messages from the 718 that were sitting unsorted in
// royhenderson@craudiovizai.com on 2026-08-27, plus the specific failures that
// motivated each rule. Nothing here is invented.
//
// The point of this file is that a rule change can be checked in a second
// instead of by running the manager against 14 live mailboxes and reading the
// damage afterwards.
//
// Run: node email-manager/test/triage.test.js
//
// CR AudioViz AI, LLC · EIN 39-3646201 · 2026-08-27

'use strict';

const { triage, addressOf, domainOf } = require('../lib/triage.js');

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 200 * 86400000).toISOString();

// Thread shapes, named so the cases read as English.
const NOT_OURS   = { weSent: false, newestIsInbound: true };
const WAITING_US = { weSent: true,  newestIsInbound: true };
const WAITING_THEM = { weSent: true, newestIsInbound: false };
const CLOSED     = { weSent: true,  newestIsInbound: true, closed: true };

const CASES = [

  // ── The failure this whole rewrite exists for ───────────────────────────
  //
  // Same address, same "Re:" prefix, opposite answers. No subject-line rule
  // can separate these; thread state separates them without trying.
  ['broadcast', 'onboarding drip with a fake Re: — we were never in this thread',
   { from: 'hello@stackblitz.com', subject: 'Re: How is your first week with Bolt.new?',
     date: NOW, listUnsubscribe: '<https://stackblitz.com/unsub>' }, NOT_OURS],

  ['waiting', 'a real reply in a thread we opened',
   { from: 'app@base44.com', subject: 'Base44 Support Response: Billed twice for a total over $900',
     date: NOW }, WAITING_US],

  // ── Thread state, the rest of it ────────────────────────────────────────
  ['record', 'they closed the ticket — finished, not an action',
   { from: 'team@elevenlabs.io', subject: 'Your ticket (#360465) has been set as solved.',
     date: NOW }, WAITING_US],

  ['record', 'closed flag carried on the thread itself',
   { from: 'fsdsupport@gsa.gov', subject: 'Comment added to INC-GSAFSD20169301',
     date: NOW }, CLOSED],

  ['record', 'we spoke last — the ball is on their side',
   { from: 'support@supabase.com', subject: 'Re: Account Deletion Request',
     date: NOW }, WAITING_THEM],

  ['record', 'a thread that went quiet 200 days ago stops costing attention',
   { from: 'ryans@assemblyai.com', subject: 'Re: AssemblyAI - anything we can do better?',
     date: OLD }, WAITING_US],

  // ── Money and safety outrank thread state ───────────────────────────────
  ['waiting', 'failed charge — the period bug case, two periods in the gap',
   { from: 'failed-payments+acct_1qk05ld5kgnlq3da@stripe.com',
     subject: '$465.56 payment to Base44, Inc. was unsuccessful again',
     date: NOW, listUnsubscribe: '<mailto:x@stripe.com>' }, NOT_OURS],

  ['waiting', 'exposed credential, from a sender we are not in a thread with',
   { from: 'security@getgitguardian.com',
     subject: '[craudioviz/craudiovizai-site] Netlify Token v2 exposed',
     date: NOW }, NOT_OURS],

  ['waiting', 'stated suspension',
   { from: 'team@netlify.com',
     subject: '[Netlify] Your projects have been suspended due to credit limit exceeded',
     date: NOW }, NOT_OURS],

  // ── Inbound offers batch, they do not interrupt ─────────────────────────
  ['opportunity', 'the 66 that started this — no noun for a regex to match',
   { from: 'help@awin.com', subject: 'PersonalHour has invited you to join their program',
     date: NOW }, NOT_OURS],

  ['opportunity', 'a merchant writing directly',
   { from: 'imarku@imarku.net', subject: "Let's Explore a Partnership with Imarku",
     date: NOW }, NOT_OURS],

  // ── Bulk mail proves itself, from senders nobody catalogued ─────────────
  //
  // The point of these two: neither sender is in any list anywhere. The header
  // is what decides, which is why this scales past whoever writes tomorrow.
  ['broadcast', 'a sender never seen before, declared by its own header',
   { from: 'someone@a-brand-new-vendor.example', subject: 'Big news from our team',
     date: NOW, listUnsubscribe: '<https://x.example/u>' }, NOT_OURS],

  ['broadcast', 'declared bulk precedence instead',
   { from: 'newsletter@another-unknown.example', subject: 'March roundup',
     date: NOW, precedence: 'bulk' }, NOT_OURS],

  ['record', 'declared auto-generated',
   { from: 'robot@unknown-service.example', subject: 'Nightly job report',
     date: NOW, autoSubmitted: 'auto-generated' }, NOT_OURS],

  // ── Statements of fact ──────────────────────────────────────────────────
  ['record', 'a receipt',
   { from: 'invoice+statements@vercel.com', subject: 'Your receipt from Vercel Inc. #2008-4218',
     date: NOW }, NOT_OURS],

  ['record', 'a one-time code',
   { from: 'no-response@cj.com', subject: 'CJ Affiliate - One-Time Verification Code',
     date: NOW }, NOT_OURS],

  // ── Rejections are records, not decisions ───────────────────────────────
  ['declined', 'a partnership rejection, even inside a thread we opened',
   { from: 'notifications@app.impact.com',
     subject: 'Sorry, your partnership request was declined', date: NOW }, WAITING_US],

  ['waiting', 'but "declined" about MONEY is still a failed charge',
   { from: 'billing@example.com', subject: 'Your card was declined for invoice 41',
     date: NOW }, NOT_OURS],

  ['record', "the manager's own brief files itself",
   { from: 'Javari Email Manager <craudiovizai@gmail.com>',
     subject: 'Javari filed 497 | 9 actions need you | Aug 27', date: NOW }, NOT_OURS],

  // ── Fraud ───────────────────────────────────────────────────────────────
  ['junk', 'fraud',
   { from: 'x@y.example', subject: 'You have won a million dollars, claim your prize',
     date: NOW }, NOT_OURS],

  // ── Refusal is still available, and still the right answer ──────────────
  ['unsorted', 'a person we have never heard from, no headers, no thread',
   { from: 'omer@evolvedpr.com', subject: 'Quick question about your platform',
     date: NOW }, NOT_OURS],
];

let pass = 0;
const failures = [];

for (const [want, why, msg, thread] of CASES) {
  const got = triage(msg, thread);
  if (got.bucket === want) pass++;
  else failures.push({ want, why, got, msg });
}

// The refusal must announce itself as a model candidate, not quietly vanish.
const refusal = triage(
  { from: 'omer@evolvedpr.com', subject: 'Quick question about your platform', date: NOW },
  NOT_OURS);
if (refusal.needsModel === true) pass++;
else failures.push({ want: 'needsModel=true', why: 'refusal asks for the model',
                     got: refusal, msg: {} });

// Reputation is consulted, and an 'unsorted' reputation never overrides a
// refusal into a false confidence.
const rep = new Map([['weronika.kaminska@kinguin.net', 'opportunity']]);
const learned = triage(
  { from: 'Weronika <weronika.kaminska@kinguin.net>', subject: 'Cooperation with Kinguin',
    date: NOW }, NOT_OURS, rep);
if (learned.bucket === 'opportunity' && learned.source === 'reputation') pass++;
else failures.push({ want: 'opportunity/reputation', why: 'learned sender',
                     got: learned, msg: {} });

const HELPERS = [
  [addressOf('Awin <help@awin.com>'), 'help@awin.com'],
  [addressOf('HELP@AWIN.COM'), 'help@awin.com'],
  [addressOf(''), ''],
  [domainOf('Awin <help@awin.com>'), 'awin.com'],
];
for (const [got, want] of HELPERS) {
  if (got === want) pass++;
  else failures.push({ want, why: 'helper', got: { bucket: got }, msg: {} });
}

let total = CASES.length + 2 + HELPERS.length;

// ── graphThreadState: pure, so the real logic is exercised here ────────────
{
  const { graphThreadState } = require('../lib/thread-state.js');
  const { RX } = require('../lib/triage.js');
  const sent = new Map([['conv-open', '2026-08-20T10:00:00Z'],
                        ['conv-answered', '2026-08-26T10:00:00Z']]);
  const T = [
    ['never sent into it',
     { conversationId: 'conv-unknown', receivedDateTime: '2026-08-27T10:00:00Z' },
     { weSent: false, newestIsInbound: true }],
    ['they replied after we spoke — waiting on us',
     { conversationId: 'conv-open', receivedDateTime: '2026-08-25T10:00:00Z' },
     { weSent: true, newestIsInbound: true }],
    ['we spoke last — ball on their side',
     { conversationId: 'conv-answered', receivedDateTime: '2026-08-24T10:00:00Z' },
     { weSent: true, newestIsInbound: false }],
    ['no conversationId at all',
     { receivedDateTime: '2026-08-27T10:00:00Z' },
     { weSent: false, newestIsInbound: true }],
  ];
  for (const [why, msg, want] of T) {
    const got = graphThreadState(msg, sent, RX.RX_CLOSED);
    if (got.weSent === want.weSent && got.newestIsInbound === want.newestIsInbound) {
      pass++;
    } else {
      console.log(`  FAIL  thread-state: ${why}`);
      console.log(`        want weSent=${want.weSent} newestIsInbound=${want.newestIsInbound}`);
      console.log(`        got  weSent=${got.weSent} newestIsInbound=${got.newestIsInbound}`);
      process.exitCode = 1;
    }
  }
  total += T.length;
}



// ── graphHeader reads both shapes Graph can return ────────────────────────
{
  const { graphHeader } = require('../lib/thread-state.js');
  const G = '{00020386-0000-0000-C000-000000000046}';
  const checks = [
    ['extended property (what a collection query returns)',
     { singleValueExtendedProperties: [
        { id: `String ${G} Name List-Unsubscribe`, value: '<https://x/u>' }] },
     'List-Unsubscribe', '<https://x/u>'],
    ['case-insensitive on the header name',
     { singleValueExtendedProperties: [
        { id: `String ${G} Name list-unsubscribe`, value: '<mailto:u@x>' }] },
     'List-Unsubscribe', '<mailto:u@x>'],
    ['internetMessageHeaders (what a single GET returns)',
     { internetMessageHeaders: [{ name: 'Precedence', value: 'bulk' }] },
     'Precedence', 'bulk'],
    ['absent is undefined, not a throw',
     {}, 'List-Unsubscribe', undefined],
  ];
  for (const [why, msg, name, want] of checks) {
    const got = graphHeader(msg, name);
    if (got === want) pass++;
    else {
      console.log(`  FAIL  graphHeader: ${why}  want=${want} got=${got}`);
      process.exitCode = 1;
    }
  }
  total += checks.length;
}



// ── A reputation of 'waiting' is a candidate, not a verdict ───────────────
//
// Measured on live mail: 39 of 50 actions came from the seed map and only 6
// from real thread state, because vendor support often lives in a portal and
// never becomes a visible email thread. The reputation is still right about
// the CHANNEL; it says nothing about whether this particular item is open.
{
  const rep = new Map([['fsdsupport@gsa.gov', 'waiting']]);
  const stale = new Date(Date.now() - 120 * 86400000).toISOString();
  const checks = [
    ['open and recent — still an action',
     { from: 'fsdsupport@gsa.gov', subject: 'Comment added to INC-GSAFSD20169301', date: NOW },
     'waiting'],
    ['same sender, closed — a record',
     { from: 'fsdsupport@gsa.gov', subject: 'Incident INC-GSAFSD20169301 was closed', date: NOW },
     'record'],
    ['same sender, silent 120 days — a record',
     { from: 'fsdsupport@gsa.gov', subject: 'Comment added to INC-GSAFSD20169301', date: stale },
     'record'],
  ];
  for (const [why, msg, want] of checks) {
    const got = triage(msg, NOT_OURS, rep);
    if (got.bucket === want) pass++;
    else {
      console.log(`  FAIL  reputation gate: ${why}  want=${want} got=${got.bucket}`);
      console.log(`        engine said: ${got.reason}`);
      process.exitCode = 1;
    }
  }
  total += checks.length;
}

// ── Report last, and only once. ───────────────────────────────────────────
//
// An earlier version of this file called process.exit() here, in the middle,
// and then appended more cases below it. They never ran and the suite still
// printed "24/24 passed" — a test file that lies about its own coverage is
// worse than no test file.
console.log(`triage: ${pass}/${total} passed`);
for (const f of failures) {
  console.log(`  FAIL  want=${f.want}  got=${f.got.bucket}`);
  console.log(`        ${f.why}`);
  if (f.msg.subject) console.log(`        ${f.msg.from} :: ${f.msg.subject}`);
  if (f.got.reason) console.log(`        engine said: ${f.got.reason}`);
}
process.exit(failures.length || process.exitCode ? 1 : 0);
