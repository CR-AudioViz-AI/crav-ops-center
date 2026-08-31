/**
 * lib/platform-secrets/env-shim.ts
 *
 * 2026-08-30. THE PROXY IS GONE. It took a production site down.
 *
 * WHAT THIS USED TO DO: replace process.env with a Proxy whose get() trap fell
 * through to the vault for any key not in the bootstrap list. Clever, and clever
 * was the problem — it put our code on EVERY process.env read the framework makes.
 *
 * Under Next 15 that is fatal. Proven by single-variable isolation on
 * javari-intelligence-layer, after two confident wrong answers:
 *
 *   removed the edge crypto fallback        500   not the bundler
 *   removed track() from middleware         500   not the SDK on edge
 *   neutralised register() entirely         200   instrumentation confirmed
 *   restored track + non-blocking warm      500   TWO variables, told me nothing
 *   restored track, skipped installEnvShim  200   THE PROXY. Definitively.
 *
 * The 40-key warm was never the cause. Making it non-blocking fixed the wrong half.
 *
 * WHAT IT DOES NOW: hydrates. Vault values are ASSIGNED INTO process.env as plain
 * strings at boot. process.env stays an ordinary object that Next, Node and every
 * library can read without passing through anything we wrote.
 *
 * WHY THIS IS THE FUTURE-PROOF SHAPE, beyond fixing the outage:
 *   - No dependency on process.env internals surviving Next 16, 17 or whatever
 *     replaces webpack. A plain string assignment cannot be incompatible.
 *   - AUDITABLE. You can grep which code reads which credential. That was
 *     impossible with the Proxy, and it is why three live Vercel projects read a
 *     deleted R2 bucket from env config while a full code sweep found ZERO callers.
 *   - TESTABLE. Seed process.env in a test instead of patching a global Proxy.
 *   - Hydration is an OPTIMISATION, never a precondition. A key that fails to
 *     resolve leaves whatever Vercel already had, so the app degrades to its
 *     previous behaviour rather than to nothing.
 *   - THE VAULT WINS over a Vercel env var of the same name. Taken from
 *     craudiovizai's shim, which measured it: 149 of 188 migrated secrets were
 *     shadowed by same-named Vercel vars and never read. My first version skipped
 *     those keys and would have re-created that bug across 53 repos.
 *
 * THE BOOTSTRAP SET IS NEVER OVERWRITTEN. Those four are what the vault itself
 * needs to open; hydrating them from the vault would be circular.
 *
 * CR AudioViz AI, LLC · EIN 39-3646201
 */

import { warmSecrets, getSecretSync, cacheStats } from "./getSecret";

/** Real environment variables. Never hydrated — the vault needs these to open. */
const BOOTSTRAP = new Set<string>([
  "NEXTAUTH_SECRET", "SUPABASE_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PLATFORM_SECRETS_KEY",
  // 2026-08-30, taken from craudiovizai's version: SUPABASE_SECRET_KEY is NOT
  // optional here. secretKey() reads process.env.SUPABASE_SECRET_KEY, and resolving
  // that FROM the vault needs a Supabase connection, which needs this key. A
  // deadlock — and one that only appears once the legacy key stops answering.
  // NEXT_PUBLIC_ names need no entry; they are never hydrated.
  "SUPABASE_SECRET_KEY",
  "NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "PORT", "PATH", "HOME",
]);

const HYDRATE_KEYS = [
  "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY",
  "COHERE_API_KEY", "FIREWORKS_API_KEY", "REPLICATE_API_TOKEN", "REPLICATE_API_KEY",
  "STABILITY_API_KEY", "ELEVENLABS_API_KEY", "FAL_KEY", "FAL_API_KEY",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MODE",
  "RESEND_API_KEY", "GITHUB_TOKEN", "GH_PAT", "CRON_SECRET", "ADMIN_SECRET",
  "INTERNAL_API_SECRET", "CANONICAL_ADMIN_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_FROM",
  "DISCORD_WEBHOOK_URL", "TMDB_API_KEY", "NASA_API_KEY", "FRED_API_KEY",
  "TAVILY_API_KEY", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
];

let hydrated = 0;
let ran = false;

/**
 * Assign vault values into process.env as plain strings.
 *
 * Kept the name installEnvShim so every existing caller keeps working — the
 * behaviour changed, the contract did not. Callers that awaited a Proxy install
 * now await a hydration, and both are "make secrets available".
 */
export async function installEnvShim(): Promise<{ hydrated: number; skipped: number }> {
  if (ran) return { hydrated, skipped: 0 };
  ran = true;

  let skipped = 0;
  const keys = HYDRATE_KEYS.filter((k) => !BOOTSTRAP.has(k));

  // 2026-08-31: ONE round trip, PARALLEL derivation.
  //
  // warmSecrets made one HTTP request PER SECRET and derived each key with a
  // blocking pbkdf2Sync. At ~23 ms per derivation the cost is serialised, and on
  // core that overran the hydration ceiling — hydration was cut off mid-flight on
  // every cold start and whatever had not been derived never reached process.env.
  //
  // bulkLoadSecrets fetches every row in a single PostgREST select and derives on
  // libuv's threadpool, so the work runs in parallel and the event loop stays free.
  // Core's cold start went from 9,258 ms with groq:error:401 to 151 ms healthy.
  let loaded: Record<string, string> = {};
  try {
    const { bulkLoadSecrets } = await import("@/lib/vault/bulkLoad");
    loaded = await bulkLoadSecrets(keys);
  } catch {
    // A vault that will not answer leaves every value exactly as Vercel set it.
    // The app runs on its previous configuration rather than refusing to boot,
    // which is the whole lesson of the outage this replaced.
    return { hydrated: 0, skipped: keys.length };
  }

  for (const key of keys) {
    const value = loaded[key] ?? null;
    if (value === null) { skipped++; continue; }
    // THE VAULT WINS. This overwrites a Vercel env var of the same name, and that
    // is deliberate.
    //
    // 2026-08-30: my first version skipped keys Vercel had already set, reasoning
    // that an operator who pinned an override meant it. craudiovizai's shim had
    // already MEASURED the opposite and I was about to re-create the bug it fixed:
    // of 188 secrets migrated into the vault, 149 WERE SHADOWED by a Vercel env var
    // of the same name and were never read. "Real env wins" was correct only while
    // secrets were being migrated in; once the migration finished it became the
    // thing stopping the vault from working at all.
    //
    // So the vault is the source of truth and Vercel env is the FALLBACK for
    // anything the vault has not got — which is what the bootstrap set above is
    // for, and nothing else.
    process.env[key] = value;
    hydrated++;
  }

  return { hydrated, skipped };
}

/** Backwards-compatible alias. Hydration happens inside installEnvShim now. */
export async function warmEnvShim(): Promise<{ warmed: number; cache: { size: number } }> {
  const r = await installEnvShim();
  return { warmed: r.hydrated, cache: { size: cacheStats().size } };
}

export function envShimStatus(): { installed: boolean; hydrated: number; cacheSize: number } {
  return { installed: ran, hydrated, cacheSize: cacheStats().size };
}

export default { installEnvShim, warmEnvShim, envShimStatus };
