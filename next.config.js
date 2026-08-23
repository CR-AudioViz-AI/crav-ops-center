/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
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
