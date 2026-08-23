// sentry.client.config.ts
// 2026-08-26. No session replay - the heaviest quota feature, and there are no
// users yet to replay.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.05,
    enabled: process.env.NEXT_PUBLIC_VERCEL_ENV === "production",
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
    ],
  });
}
