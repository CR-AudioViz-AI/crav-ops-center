// lib/platform-secrets/crypto.ts
// CR AudioViz AI — Platform Secret Authority: Encryption Engine (RESTORED)
// SERVER-SIDE ONLY. Node.js runtime. Never import in edge/client.
//
// This file was overwritten with an "// auto-stub" that returned empty strings,
// which silently broke every getSecret() call and forced the platform back onto
// process.env. Restored 2026-07-13 with the ORIGINAL, verified crypto — validated
// by decrypting all live secrets in platform_secrets before commit.
//
// Envelope formats supported (read):
//   v1: base64(JSON{ v:1, salt:hex, iv:hex, tag:hex, ct:hex })
//       key = PBKDF2-SHA256(`${NEXTAUTH_SECRET}:${SUPABASE_PROJECT_REF}`, salt, 100000, 32)
//   v2: JSON{ v:2, enc:"base64", ct:base64 }   (non-secret/public values)
// Write format: always v1 (authenticated AES-256-GCM).
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const ITERATIONS = 100_000;
const KEY_LEN = 32;
const IV_LEN = 12;

export interface EncryptedEnvelope {
  v: number;
  salt?: string;
  iv?: string;
  tag?: string;
  ct: string;
  enc?: string;
}

function keyMaterial(): string {
  const nas = process.env.NEXTAUTH_SECRET;
  const ref = process.env.SUPABASE_PROJECT_REF
    ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace("https://", "").split(".")[0];
  if (!nas) throw new Error("NEXTAUTH_SECRET is required for vault key derivation");
  if (!ref) throw new Error("SUPABASE_PROJECT_REF (or NEXT_PUBLIC_SUPABASE_URL) is required for vault key derivation");
  return `${nas}:${ref}`;
}

function deriveKey(saltHex: string): Buffer {
  return pbkdf2Sync(keyMaterial(), Buffer.from(saltHex, "hex"), ITERATIONS, KEY_LEN, "sha256");
}

/** Encrypt to a v1 authenticated envelope, base64(JSON). */
export function encryptValue(plaintext: string): string {
  if (typeof plaintext !== "string") throw new TypeError("encryptValue: plaintext must be a string");
  const salt = randomBytes(32);
  const iv = randomBytes(IV_LEN);
  const key = pbkdf2Sync(keyMaterial(), salt, ITERATIONS, KEY_LEN, "sha256");
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const env: EncryptedEnvelope = {
    v: 1, salt: salt.toString("hex"), iv: iv.toString("hex"),
    tag: tag.toString("hex"), ct: ct.toString("hex"),
  };
  return Buffer.from(JSON.stringify(env)).toString("base64");
}

/** Decrypt a v1 or v2 envelope (accepts base64 wrapper or raw JSON). */
export function decryptValue(stored: string): string {
  if (typeof stored !== "string" || stored.length === 0) {
    throw new Error("decryptValue: empty value");
  }
  let env: EncryptedEnvelope;
  const trimmed = stored.trim();
  if (trimmed.startsWith("{")) {
    env = JSON.parse(trimmed) as EncryptedEnvelope;
  } else {
    env = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8")) as EncryptedEnvelope;
  }

  if (env.v === 2 && env.enc === "base64") {
    return Buffer.from(env.ct, "base64").toString("utf8");
  }
  if (env.v === 1 && env.salt && env.iv && env.tag) {
    const key = deriveKey(env.salt);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(env.iv, "hex"));
    decipher.setAuthTag(Buffer.from(env.tag, "hex"));
    const pt = Buffer.concat([decipher.update(Buffer.from(env.ct, "hex")), decipher.final()]);
    return pt.toString("utf8");
  }
  throw new Error(`decryptValue: unsupported envelope version ${env.v}`);
}

/** SHA-256 fingerprint (first 16 hex) for change detection — never reversible. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export const deriveKeyForSalt = deriveKey;
export default { encryptValue, decryptValue, fingerprint };

// ── Compatibility aliases (index.ts and legacy call sites) ────────────────────
export const encrypt = encryptValue;
export const decrypt = decryptValue;
export function maskSecret(value: string): string {
  if (!value || value.length < 4) return "****";
  return value.slice(0, 4) + "*".repeat(Math.min(value.length - 4, 20));
}
