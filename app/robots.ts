// app/robots.ts — what crawlers may index, and where the map is
//
// 2026-08-16: this app had no robots.txt at all, so every crawler guessed.
// AI crawlers are explicitly welcomed: being cited by an assistant is
// distribution, and blocking them costs reach for no security benefit —
// nothing private is behind a public URL.
import type { MetadataRoute } from 'next'

const BASE = 'https://ops.craudiovizai.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Admin and API surfaces are not content. Excluding them keeps the
        // index clean and stops crawlers burning budget on JSON.
        disallow: ['/api/', '/admin/', '/ops/', '/auth/', '/_next/'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  }
}
