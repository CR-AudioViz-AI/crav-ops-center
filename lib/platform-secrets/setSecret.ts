// lib/platform-secrets/setSecret.ts
// CR AudioViz AI — Platform Secret Authority: write path (RESTORED)
// SERVER-SIDE ONLY. Encrypts with v1 AES-256-GCM and upserts via
// set_platform_secret RPC. 2026-07-13
import { encryptValue, fingerprint } from "@/lib/platform-secrets/crypto";
import { cacheInvalidate } from "@/lib/vault/getSecret";
import { secretKey, supabaseUrl } from "@craudioviz/platform-sdk";

const SB_URL = supabaseUrl();
const SB_SERVICE = secretKey();

export interface SetSecretOptions {
  category?: string;
  updatedBy?: string;
  notes?: string;
}

export async function setSecret(
  key: string,
  value: string,
  opts: SetSecretOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  if (!SB_URL || !SB_SERVICE) return { ok: false, error: "Supabase not configured" };
  if (!key || typeof value !== "string") return { ok: false, error: "key and string value required" };
  try {
    const encrypted = encryptValue(value);
    const res = await fetch(`${SB_URL}/rest/v1/rpc/set_platform_secret`, {
      method: "POST",
      headers: {
        apikey: SB_SERVICE,
        Authorization: `Bearer ${SB_SERVICE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_key: key,
        p_value_encrypted: encrypted,
        p_description: opts.notes ?? `Set ${new Date().toISOString()} by ${opts.updatedBy ?? "system"}`,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: false, error: `RPC ${res.status}` };
    cacheInvalidate(key);
    void fingerprint; // reserved for change-detection audit
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export default setSecret;

export interface SetSecretResult { ok: boolean; error?: string; }
export type SecretCategory = "ai" | "payments" | "social" | "analytics" | "infrastructure" | "general" | "data";

export async function setSecrets(
  entries: Array<{ key: string; value: string; category?: string }>,
  opts: SetSecretOptions = {}
): Promise<{ ok: number; failed: Array<{ key: string; error: string }> }> {
  let ok = 0;
  const failed: Array<{ key: string; error: string }> = [];
  for (const e of entries) {
    const r = await setSecret(e.key, e.value, { ...opts, category: e.category });
    if (r.ok) ok++;
    else failed.push({ key: e.key, error: r.error ?? "unknown" });
  }
  return { ok, failed };
}
