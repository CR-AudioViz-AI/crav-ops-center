// lib/platform-secrets/getSecret.ts
// CR AudioViz AI — Platform Secret Authority: read path + sync cache.
// Delegates async reads to the vault; maintains a synchronous cache so the
// env-shim Proxy can return vault values from sync process.env reads.
// SERVER-SIDE ONLY. 2026-07-13
import {
  getSecret as vaultGetSecret,
  cacheInvalidate,
  cacheStats as vaultCacheStats,
} from "@/lib/vault/getSecret";

// Synchronous mirror cache — populated by warmSecrets(); read by getSecretSync().
const SYNC_CACHE = new Map<string, string>();

export { cacheInvalidate };
export function cacheStats(): { size: number; keys: string[] } {
  return { size: SYNC_CACHE.size, keys: Array.from(SYNC_CACHE.keys()) };
}

export async function getSecret(key: string): Promise<string | null> {
  try {
    const v = await vaultGetSecret(key);
    if (v !== null) SYNC_CACHE.set(key, v);
    return v;
  } catch {
    return process.env[key] ?? null;
  }
}

/** Synchronous read — returns a warmed vault value, or falls back to env. */
export function getSecretSync(key: string): string | null {
  const cached = SYNC_CACHE.get(key);
  if (cached !== undefined) return cached;
  return process.env[key] ?? null;
}

/** Pre-warm the sync cache for a set of keys (vault → SYNC_CACHE). */
export async function warmSecrets(keys: string[]): Promise<number> {
  let ok = 0;
  await Promise.all(
    keys.map(async (k) => {
      try {
        const v = await vaultGetSecret(k);
        if (v !== null) { SYNC_CACHE.set(k, v); ok++; }
      } catch { /* skip */ }
    })
  );
  return ok;
}

void vaultCacheStats;
export default getSecret;
