// middleware.ts — visitor tracking
//
// 2026-08-16: this app had no middleware, so nothing it served was ever logged.
// Its only job is to log the request and get out of the way.
//
// CR AudioViz AI, LLC · EIN 39-3646201
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server'
import { track } from '@/lib/analytics/track'

export function middleware(request: NextRequest, event: NextFetchEvent): NextResponse {
  const response = NextResponse.next()
  try {
    // waitUntil, not void: in Edge the invocation ends when the response is
    // returned and a detached fetch is killed before it completes.
    event.waitUntil(track({
      path: request.nextUrl.pathname,
      method: request.method,
      userAgent: request.headers.get('user-agent') ?? '',
      referrer: request.headers.get('referer'),
      ip: (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
      country: request.headers.get('x-vercel-ip-country'),
      appId: request.nextUrl.hostname,
      sessionId: request.cookies.get('zsid')?.value ?? null,
      userId: null,
    }))
  } catch {
    // Never let tracking break a request.
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.webp|.*\\.ico).*)'],
}
