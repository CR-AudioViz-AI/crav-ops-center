// lib/vault/getSecret.ts
// CR AudioViz AI — Platform Secret Authority: canonical read path (RESTORED)
// SERVER-SIDE ONLY. Node.js runtime.
// 2026-07-13
//
// Resolution order:
//   1. In-process cache (TTL 5 min)
//   2. platform_secrets via get_platform_secret RPC → decrypt (v1/v2)
//   3. process.env fallback (logs VAULT_FALLBACK_USED for migration tracking)
import { decryptValue } from "@/lib/platform-secrets/crypto";
import { secretKey, supabaseUrl } from "@craudioviz/platform-sdk";

interface CacheEntry { value: string | null; at: number; }
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

const SB_URL = supabaseUrl();
const SB_SERVICE = secretKey();

async function fetchFromVault(key: string): Promise<string | null> {
  if (!SB_URL || !SB_SERVICE) return null;
  const res = await fetch(`${SB_URL}/rest/v1/rpc/get_platform_secret`, {
    method: "POST",
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_key: key }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const raw = (await res.json()) as string | null;
  if (!raw || typeof raw !== "string") return null;
  try {
    return decryptValue(raw);
  } catch {
    return null; // corrupt/legacy row — caller falls back to env
  }
}

export async function getSecret(key: string): Promise<string | null> {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: string | null = null;
  try {
    value = await fetchFromVault(key);
  } catch {
    value = null;
  }

  if (value === null) {
    const envVal = process.env[key];
    if (envVal) {
      console.warn(JSON.stringify({ level: "WARN", event: "VAULT_FALLBACK_USED", key }));
      value = envVal;
    }
  }

  CACHE.set(key, { value, at: Date.now() });
  return value;
}

export function cacheInvalidate(key?: string): void {
  if (key) CACHE.delete(key);
  else CACHE.clear();
}

export function cacheStats(): { size: number; keys: string[] } {
  return { size: CACHE.size, keys: Array.from(CACHE.keys()) };
}

export default getSecret;
