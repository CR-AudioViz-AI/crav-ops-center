// app/api/vault-status/route.ts
// Proves the vault is reachable and decrypting FROM THIS APP.
//
// The first version reported cacheStats(), which was the wrong measurement: on
// Vercel, instrumentation.ts register() runs per Lambda instance and the sync
// cache is module-level, so a route can legitimately run in an instance where
// nothing has warmed yet. An empty cache proves nothing.
//
// This calls getSecret() directly and reports whether the vault answered.
// Names and lengths only — never values.
import { NextResponse } from 'next/server'
import { getSecret, cacheStats } from '@/lib/platform-secrets/getSecret'

export const dynamic = 'force-dynamic'

// Keys every app should be able to resolve. Chosen because they exist in the
// vault and are safe to report the presence of.
const PROBE = ['GROQ_API_KEY', 'RESEND_API_KEY', 'FRED_API_KEY']

export async function GET(): Promise<NextResponse> {
  const results: Record<string, { fromVault: boolean; length: number }> = {}
  for (const k of PROBE) {
    let v: string | null = null
    try {
      v = await getSecret(k)
    } catch {
      v = null
    }
    results[k] = { fromVault: Boolean(v), length: v ? v.length : 0 }
  }
  const ok = Object.values(results).filter((r) => r.fromVault).length
  return NextResponse.json({
    vaultReachable: ok > 0,
    resolved: ok,
    probed: PROBE.length,
    results,
    syncCacheSize: cacheStats().size,
    checkedAt: new Date().toISOString(),
  })
}
