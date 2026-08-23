// 2026-08-26: SERVER-ONLY, deliberately. The client and edge configs were removed
// after the build failed with:
//
//   Module not found: Can't resolve 'crypto'
//
// lib/platform-secrets/crypto.ts imports node's `crypto` for the vault, and
// instrumentation.ts reaches it via the env-shim. Adding a client/edge Sentry
// config pulls that graph into a browser bundle, where `crypto` does not exist.
//
// This is almost certainly what broke the core repo on 2026-08-23 - every page
// 500'd and I blamed my config options. The options were wrong too, but this is
// the mechanism.
//
// Server-side coverage is the valuable half regardless: nearly every defect this
// audit found lives in an API route - undefined identifiers, 400s on broken
// columns, fail-open auth. Browser errors can be added later behind a webpack
// fallback, once this is proven.
// sentry.server.config.ts
// Minimal, documented options only. 2026-08-26.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.05,
    enabled: process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview",
    beforeSend(event) {
      // The vault shim makes every process.env read return a real credential, so
      // an unfiltered frame could ship the whole secret store to a third party.
      if (event.extra) delete event.extra.env;
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
}
