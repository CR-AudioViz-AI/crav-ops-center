/** @type {import('next').NextConfig} */
const nextConfig = {
  // 2026-08-29: required for @craudioviz/platform-sdk. The SDK ships raw
  // TypeScript and Next does not run node_modules through SWC by default, so
  // any import carrying a `type` re-export fails the build without this.
  transpilePackages: ["@craudioviz/platform-sdk"],
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

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
});
