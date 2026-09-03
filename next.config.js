/** @type {import('next').NextConfig} */
const nextConfig = {
  // 2026-09-03: security headers. An ecosystem sweep with Javari Verify found this
  // app serving none of them - no CSP, no HSTS, no frame protection - while every
  // other app in the fleet had at least four since August. This one has no
  // headers() block at all, which is why the fleet-wide patch could not reach it:
  // that pass inserted next to an existing X-Frame-Options line.
  //
  // HSTS enforces immediately; it only tells the browser to refuse plaintext. CSP
  // ships Report-Only first so a policy that blocks something this app needs
  // reports it rather than breaking it.
  //
  // connect-src includes Sentry because this app reports to it - a CSP that blocks
  // your own error reporting hides the next incident.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy-Report-Only', value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests` },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // 2026-08-26: withSentryConfig traces instrumentation.ts, which reaches
  // lib/platform-secrets/crypto.ts and its `import ... from "crypto"`. That graph
  // gets pulled into the CLIENT bundle, where node's crypto does not exist:
  //
  //   Module not found: Can't resolve 'crypto'
  //
  // This is a standard Next.js webpack fallback, not a Sentry option - node
  // builtins resolve to false on the client. The server build is unaffected and
  // still gets the real module.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};
// 2026-08-26: DOCUMENTED OPTIONS ONLY. My first attempt at this on the core repo
// 500'd every page, because I invented a `webpack: {...}` key from a deprecation
// warning without checking it exists, and added tunnelRoute which creates a route
// that can collide. Neither is here.
//
// sourcemaps.disable is deliberate: uploading them is the slow half of the plugin
// and this org already hit Vercel's build ceiling once. Stack traces will be
// minified; file and line still report.
const { withSentryConfig } = require("@sentry/nextjs");

// 2026-08-28: withSentryConfig REMOVED, and this is why.
//
// Builds on this lineage failed with:
//   UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins
//   trace: node:crypto -> lib/platform-secrets/crypto.ts -> lib/vault/getSecret.ts
//          -> lib/platform-secrets/getSecret.ts -> lib/platform-secrets/env-shim.ts
//
// env-shim is reached from instrumentation.ts. The
// `if (NEXT_RUNTIME !== "nodejs") return;` guard inside register() is a RUNTIME
// check, so webpack still follows the import while BUILDING the edge bundle, and
// the edge target cannot resolve a node: scheme.
//
// PROVEN BY BISECTION. Removing withSentryConfig and changing nothing else
// compiles cleanly. Three webpack-level attempts did NOT work and are
// deliberately not kept:
//   - resolve.fallback keyed on !isServer   (edge reports isServer TRUE)
//   - fallback/alias with node:-prefixed keys, and alias:false
//     (webpack rejects the node: URI at the SCHEME stage, before either is
//      consulted — hence UnhandledSchemeError rather than "Can't resolve")
//   - alias pointing at a real stub module
// Adding the missing sentry.edge.config.ts did not fix it either.
// The webpack block above is UNCHANGED; it was never the problem.
//
// TRADE-OFF: this drops Sentry's build-time plugin — release association and
// server-side auto-instrumentation. sentry.server.config.ts still runs from
// instrumentation.ts, so runtime error capture is unaffected. Restoring the
// plugin needs instrumentation.ts to stop reaching node:crypto, i.e. porting
// lib/platform-secrets/crypto.ts to Web Crypto — a real change to the credential
// store, not something to rush.
module.exports = nextConfig;
