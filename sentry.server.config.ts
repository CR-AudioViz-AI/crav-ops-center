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
