// lib/vault/bulkLoad.ts
//
// 2026-08-31. Load every needed secret in ONE round trip and derive the keys in
// PARALLEL. This replaces a warm path that made one HTTP request per secret and
// derived each key with a BLOCKING pbkdf2Sync.
//
// THE ARITHMETIC THAT MADE THIS NECESSARY, measured rather than assumed:
//
//   PBKDF2 at 100,000 iterations  = ~23 ms per secret
//   pbkdf2Sync BLOCKS the event loop, so cost is SERIALISED
//   181 secrets                   = ~4.1 s against a 4 s hydration ceiling
//
// Hydration was being cut off mid-flight on every cold start, and whatever had not
// been derived never reached process.env. That is why deleting Vercel copies broke
// production twice while getSecret() returned a correct key when called directly:
// the vault was always fine, the boot budget was not.
//
// TWO CHANGES, both about wall-clock time rather than correctness:
//
//   ONE REQUEST instead of N. A PostgREST select returns every row at once. Eighty
//   round trips at even 20 ms each is 1.6 s of pure latency for data that fits in a
//   single response.
//
//   ASYNC pbkdf2 instead of pbkdf2Sync. The callback form runs on libuv's
//   threadpool, so derivations proceed in PARALLEL and — more importantly — do not
//   block the event loop while they do. A boot path that pins the main thread for
//   two seconds is a boot path that cannot answer a health check.
//
// CR AudioViz AI, LLC · EIN 39-3646201

import { pbkdf2, createDecipheriv } from "crypto";
import { promisify } from "util";

const pbkdf2Async = promisify(pbkdf2);

const ALGORITHM = "aes-256-gcm";
const ITERATIONS = 100_000;
const KEY_LEN = 32;

interface Envelope {
  v: number;
  salt?: string;
  iv?: string;
  tag?: string;
  ct: string;
  enc?: string;
}

function keyMaterial(): string | null {
  const nas = process.env["NEXTAUTH_SECRET"];
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const ref =
    process.env["SUPABASE_PROJECT_REF"] ??
    (url ? url.replace("https://", "").split(".")[0] : undefined);
  if (!nas || !ref) return null;
  return `${nas}:${ref}`;
}

function parseEnvelope(stored: string): Envelope | null {
  try {
    const t = stored.trim();
    return JSON.parse(
      t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8"),
    ) as Envelope;
  } catch {
    return null;
  }
}

/**
 * Fetch and decrypt the named secrets. Returns only what decrypted cleanly — a
 * corrupt row is skipped rather than throwing, because one bad envelope must not
 * cost the other eighty.
 */
export async function bulkLoadSecrets(
  names: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (names.length === 0) return out;

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const svc =
    process.env["SUPABASE_SECRET_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const material = keyMaterial();
  if (!url || !svc || !material) return out;

  // ONE request. `in.(...)` keeps the response to what this app needs rather than
  // shipping every row and filtering client-side.
  const list = names.map((n) => `"${n}"`).join(",");
  let rows: Array<{ name: string; encrypted_value: string }> = [];
  try {
    const res = await fetch(
      `${url}/rest/v1/platform_secrets?select=name,encrypted_value&is_active=eq.true&name=in.(${encodeURIComponent(list)})`,
      {
        headers: {
          apikey: svc,
          Authorization: `Bearer ${svc}`,
          // A browser User-Agent is REJECTED by the sb_secret_ keys — that broke
          // four pipeline scripts on 2026-08-29.
          "User-Agent": "craudiovizai-vault/1.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return out;
    rows = (await res.json()) as typeof rows;
  } catch {
    return out;
  }
  if (!Array.isArray(rows)) return out;

  // Derive in parallel on the threadpool. Promise.all over the async form lets
  // libuv run several derivations at once AND keeps the event loop free between
  // them, which the synchronous form cannot do at any concurrency.
  await Promise.all(
    rows.map(async (row) => {
      const env = parseEnvelope(row.encrypted_value);
      if (!env) return;

      if (env.v === 2 && env.enc === "base64") {
        out[row.name] = Buffer.from(env.ct, "base64").toString("utf8");
        return;
      }
      if (env.v !== 1 || !env.salt || !env.iv || !env.tag) return;

      try {
        const key = (await pbkdf2Async(
          material,
          Buffer.from(env.salt, "hex"),
          ITERATIONS,
          KEY_LEN,
          "sha256",
        )) as Buffer;
        const d = createDecipheriv(ALGORITHM, key, Buffer.from(env.iv, "hex"));
        d.setAuthTag(Buffer.from(env.tag, "hex"));
        out[row.name] = Buffer.concat([
          d.update(Buffer.from(env.ct, "hex")),
          d.final(),
        ]).toString("utf8");
      } catch {
        // Wrong key or tampered ciphertext for this row only.
      }
    }),
  );

  return out;
}
