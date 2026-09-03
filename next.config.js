/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // 2026-09-04: added after Javari Verify found this origin serving 1 of 6
    // security headers. It was missed by the fleet rollout on 3 September
    // because that pass patched repos already cloned locally, and this one was
    // not among them - the gap was defined by what happened to be on disk
    // rather than by what was live.
    //
    // HSTS enforces immediately: it only instructs the browser to refuse
    // plaintext, so there is nothing for it to break. CSP ships REPORT-ONLY
    // first, because a policy that blocks a script the app actually needs takes
    // the app down. It graduates once the violation reports are quiet.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy-Report-Only', value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.paypal.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.paypal.com; frame-src 'self' https://js.stripe.com https://*.paypal.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests` },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  env: { BUILD_ID: '1779368622' },
}
module.exports = nextConfig
