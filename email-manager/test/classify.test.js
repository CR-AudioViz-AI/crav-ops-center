// email-manager/test/classify.test.js
//
// Offline test for classify(). No mailbox, no network, no credentials.
//
// WHY THIS EXISTS
//   classify() decides where roughly 500 live messages a day go across 14 real
//   mailboxes. Before this file the only way to check a rule change was to run
//   the thing against Roy's actual inbox and read the result afterwards. That is
//   not a test, it is a deployment.
//
//   Every case below is a REAL subject and sender taken from the 718 messages
//   that were sitting unsorted in royhenderson@craudiovizai.com on 2026-08-27.
//   Nothing here is invented.
//
// Run: node email-manager/test/classify.test.js
//
// CR AudioViz AI, LLC · EIN 39-3646201 · 2026-08-27

'use strict';

const { classify, addressOf, inviteMerchant } = require('../api/email-brief.js');

const CASES = [

  // ── The 66 that started this. No noun for a regex to match. ──────────────
  ['invite', 'help@awin.com', 'PersonalHour has invited you to join their program'],
  ['invite', 'help@awin.com', 'Shenzhen Cangyu Technology Co., Ltd. has invited you to join their program'],
  ['invite', 'Awin <help@awin.com>', 'UNice (US) has invited you to join their program'],
  ['invite', 'mia@jugbow.com', 'Collaboration Invitation from Jugbow'],
  ['invite', 'imarku@imarku.net', "Let's Explore a Partnership with Imarku"],
  ['invite', 'partners@wardrobesupplies.com', 'The Wardrobe Supplies x CR AudioViz AI, LLC'],

  // ── Money. Nothing outranks these. ───────────────────────────────────────
  // The period bug: two periods between "payment" and "unsuccessful".
  ['action', 'failed-payments+acct_1qk05ld5kgnlq3da@stripe.com',
             '$465.56 payment to Base44, Inc. was unsuccessful again'],
  ['action', 'team@netlify.com',
             '[Netlify] Your projects have been suspended due to credit limit exceeded on CRAudiovizAI'],

  // ── Vendor replying to a ticket WE opened. ───────────────────────────────
  ['action', 'app@base44.com', 'Base44 Support Response: Billed twice for a total over $900'],
  ['action', 'info@akool.com', 'Re: Refund $252'],
  ['action', 'support@supabase.com', 'Re: Scheduled daily backups missing on 1 and 4 August — no failure reason shown'],
  ['action', 'solutions-hub@impact.com', 'Re: Ticket Id: [#866947] - Subject: Cannot find Marketplace'],
  ['action', 'fsdsupport@gsa.gov', 'Comment added to INC-GSAFSD20169301'],
  ['action', 'security@getgitguardian.com', '[craudioviz/craudiovizai-site] Netlify Token v2 exposed'],
  ['action', 'corphelp@dos.fl.gov', 'RE: New LLC CR AudioViz AI'],

  // A mapped marketing sender can still answer a real ticket. Akool is both.
  ['notif',  'info@akool.com', 'Learn, Create, and Partner With AKOOL!'],

  // ── Ordinary vendor mail. ────────────────────────────────────────────────
  ['notif', 'invoice+statements@vercel.com', 'Your receipt from Vercel Inc. #2008-4218'],
  ['notif', 'no-response@cj.com', 'CJ Affiliate - One-Time Verification Code'],
  ['notif', 'technology@sba.gov', "America's Seed Fund July 2026 Update - Resources for Startups"],
  ['notif', 'googlecloud@google.com', 'A roadmap to turn AI vision into business value'],
  ['notif', 'hello@ko-fi.com', 'Join the community that truly gets you'],
  ['notif', 'inceptionprogram@nvidia.com', 'Join the NVIDIA Inception Welcome Session and Q&A'],

  // A KNOWN FALSE POSITIVE, asserted deliberately so it cannot change by
  // accident. StackBlitz sends onboarding drip with a fake "Re:" prefix from
  // the same address that answers real support threads, and nothing in a
  // subject line separates the two — only the thread ID would, and the
  // metadata fetch does not carry one.
  //
  // So it over-flags, on purpose. This file's own doctrine is that
  // under-flagging is worse: the cost of being wrong here is one extra line in
  // the action list, and the cost of being wrong the other way is a $900
  // double-charge filed away unread. If someone later teaches classify() to
  // read References/In-Reply-To, this expectation becomes 'notif'.
  ['action', 'hello@stackblitz.com', 'Re: How is your first week with Bolt.new?'],

  // ── Still refused. An unknown sender is not a guess we get to make. ──────
  ['unsorted', 'someone@a-company-we-have-never-heard-of.example',
               'Quick question about your platform'],
  ['unsorted', 'royhenderson@craudiovizai.com', '🛡️ Daily Security Report - Thursday, February 05, 2026'],

  // ── Behaviour that must not regress. ─────────────────────────────────────
  ['junk',     'x@y.example', 'You have won a million dollars, claim your prize'],
  ['declined', 'notifications@app.impact.com', 'Sorry, your partnership request was declined'],
];

let pass = 0;
const failures = [];

for (const [want, from, subject] of CASES) {
  const got = classify(from, subject);
  if (got === want) pass++;
  else failures.push({ want, got, from, subject });
}

// Helpers, tested separately because both silently degrade rather than throw.
const HELPERS = [
  [addressOf('Awin <help@awin.com>'), 'help@awin.com'],
  [addressOf('HELP@AWIN.COM'), 'help@awin.com'],
  [addressOf(''), ''],
  [inviteMerchant('PersonalHour has invited you to join their program'), 'PersonalHour'],
  [inviteMerchant('Collaboration Invitation from Jugbow'),
   'Collaboration Invitation from Jugbow'],          // no match -> whole subject
];
for (const [got, want] of HELPERS) {
  if (got === want) pass++;
  else failures.push({ want, got, from: '(helper)', subject: '' });
}

const total = CASES.length + HELPERS.length;
console.log(`classify: ${pass}/${total} passed`);
for (const f of failures) {
  console.log(`  FAIL want=${f.want} got=${f.got}`);
  console.log(`       ${f.from}`);
  console.log(`       ${f.subject}`);
}
process.exit(failures.length ? 1 : 0);
