# Javari Email Manager

Daily mailbox triage across 14 accounts, plus the 7am ET brief to Roy.

## Read this before touching the Vercel project

**Two different applications share the `javari-ops` Vercel project.**

1. The **Next.js app** in the root of this repo. Its production-branch builds
   have been failing since 2026-08-23 (`node:crypto` import ambiguity, Sentry
   webpack fallback). It is not what serves the cron.
2. This directory — a **bare Vercel Node functions app**. It is what actually
   runs `/api/email-brief` on the `0 11 * * *` cron. It has no Next.js build,
   so the broken build above does not block it.

The original was deployed straight from a Cowork container with the Vercel CLI:
no `githubCommitRef`, no `githubCommitSha`, and no copy in any repo. When that
container was discarded the source survived only inside deployment
`dpl_FGZfkSd72i8ccCWnfqhbcLw9vVj6`. It took a day to find it. That is why it
lives here now.

**Hazard:** because both apps target one project, a successful production build
of the root Next.js app would replace the email manager. Either fix that build
and fold this in as a route, or move this to its own Vercel project. Do not
leave it as-is indefinitely.

## Deploying

```bash
cd email-manager
vercel deploy            # preview
vercel deploy --prod     # production — Roy confirms first
```

Credentials come from the javari-ops project env (all `type=sensitive`):
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
`GMAIL_REFRESH_TOKEN_ROY`, `GMAIL_REFRESH_TOKEN_CRAUDIOVIZAI`,
`CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Testing without touching mail

```
GET /api/email-brief?dryRun=1
Authorization: Bearer $CRON_SECRET
```

Classifies everything and returns the exact brief it would have sent. No moves,
no labels created, no links followed, no mail sent, no database write.

## Behaviour

| bucket | what happens |
|---|---|
| notification | moved out of the inbox to Javari/Notifications |
| junk | moved to Javari/Junk-Review — **never deleted** |
| action | moved to Javari/Action-Required, listed with a specific instruction |
| verification | link followed, but only for allowlisted senders — see `VERIFY_SENDERS` |
| **unsorted** | **left in the inbox untouched** and listed in the brief |

`unsorted` is the important one. The previous version ended `classify()` with
`return 'notif'`, so anything it did not recognise was archived out of the inbox
silently. On the first dry run of the fixed version that was **630 messages in
one day**.

## Link-following rules

A verification link is followed only when the sender's registrable domain is on
`VERIFY_SENDERS`, the link's own host is on that same list, the message reads as
address confirmation, and nothing in `RX_NEVER_CLICK` (password, sign-in, bank,
payment, tax id, 2FA) appears anywhere in it. Anything failing any test becomes
an action item with the reason stated. Do not relax this to "looks official".
