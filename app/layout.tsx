import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  // 2026-08-16: the icons and share card existed in public/ but nothing pointed
  // at them, so every share rendered as a blank grey rectangle and every tab
  // showed a default globe.
  icons: {
    icon: [{ url: '/favicon.png', sizes: '32x32' }, { url: '/icon-512.png', sizes: '512x512' }],
    apple: '/apple-touch-icon.png',
  },
  openGraph: { images: [{ url: '/og-image.png', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image', images: ['/og-image.png'] },
  // 2026-08-16: no metadataBase meant relative og:image paths resolved against
  // the preview hostname, and no canonical meant a trailing slash, a query
  // string and a preview host all competed for the same content.
  metadataBase: new URL('https://ops.craudiovizai.com'),
  alternates: { canonical: '/' },
  title: 'AI Operations Command Center | Javariverse',
  description: 'Real-time monitoring and control center for all Javariverse applications',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  )
}
