import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
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
