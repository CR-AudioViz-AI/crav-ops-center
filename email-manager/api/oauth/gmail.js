// api/oauth/gmail.js
// One-time Gmail OAuth helper — mints the refresh tokens the email manager uses.
//
// 2026-08-26: THIS FILE IS A REIMPLEMENTATION, NOT THE RECOVERED ORIGINAL.
// The original was deployed straight from a Cowork container that no longer
// exists, and Vercel's file API returns not_found for its blob ids, so its
// source could not be retrieved the way api/email-brief.js could. Rather than
// drop the route on redeploy — which would leave no way to re-mint a refresh
// token if one is ever revoked — it is rebuilt here from the standard Google
// installed-app flow. Behaviour should match; the code will not be identical.
//
// Usage (once per Gmail account):
//   1. GET /api/oauth/gmail?setup=1        → returns the consent URL
//   2. Approve in a browser as that account
//   3. Google redirects back with ?code=…  → this route exchanges it and
//      prints the refresh token ONCE
//   4. Store it in Vercel as GMAIL_REFRESH_TOKEN_ROY or
//      GMAIL_REFRESH_TOKEN_CRAUDIOVIZAI (type: sensitive) and never again
//
// The token is displayed, never persisted here. Writing a credential into a
// response body is already more exposure than it deserves; storing it as well
// would put a second copy somewhere nobody is watching.
//
// CR AudioViz AI, LLC · EIN 39-3646201

'use strict';

const { google } = require('googleapis');

// Full mailbox scope. The manager creates labels, reads message bodies to make
// verification decisions, moves mail between labels, and sends the daily brief.
// gmail.modify alone cannot send, and gmail.send alone cannot file.
const SCOPES = [
  'https://mail.google.com/',
];

function redirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/api/oauth/gmail`;
}

function client(req) {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    redirectUri(req),
  );
}

module.exports = async (req, res) => {
  // Setup-only route, and it hands out a credential — so it is gated by the
  // same secret as the cron rather than left open on a public URL.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.query.code) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return res.status(500).json({ error: 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET are not set' });
  }

  try {
    const oauth2 = client(req);

    if (req.query.code) {
      const { tokens } = await oauth2.getToken(String(req.query.code));
      if (!tokens.refresh_token) {
        // Google only returns a refresh token on the FIRST consent for a given
        // client/account pair. A repeat run comes back without one, which reads
        // as a failure but is not — the account has to be revoked at
        // myaccount.google.com/permissions before it will issue another.
        return res.status(200).json({
          ok: false,
          message: 'No refresh_token returned. This account has already granted access to this client. '
            + 'Revoke it at https://myaccount.google.com/permissions and run setup again.',
          scope: tokens.scope,
        });
      }
      return res.status(200).json({
        ok: true,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        next: 'Store this in Vercel as GMAIL_REFRESH_TOKEN_ROY or GMAIL_REFRESH_TOKEN_CRAUDIOVIZAI (type: sensitive). It is shown once.',
      });
    }

    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',      // force a refresh token even on re-consent
      scope: SCOPES,
      include_granted_scopes: true,
    });
    return res.status(200).json({ ok: true, authorize_url: url, redirect_uri: redirectUri(req) });
  } catch (err) {
    console.error('[oauth/gmail]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
