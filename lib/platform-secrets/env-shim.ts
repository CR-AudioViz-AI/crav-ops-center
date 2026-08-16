// lib/platform-secrets/env-shim.ts
// CR AudioViz AI — Platform Secret Authority: process.env Shim
// Wraps process.env with a Proxy at Node startup. Any read of a non-bootstrap
// key transparently returns the cached vault value — so all 337 files using
// process.env.X get vault-sourced values with ZERO file changes.
// Bootstrap keys pass through to the real env (needed before the vault is reachable).
// Install once from instrumentation.ts register(); then warmEnvShim().
// SERVER-SIDE ONLY. 2026-07-13
import { getSecretSync, warmSecrets, cacheStats } from "./getSecret";

// ── Bootstrap keys — never intercepted (needed to reach the vault itself) ──────
const BOOTSTRAP = new Set<string>([
  "NEXTAUTH_SECRET", "SUPABASE_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PLATFORM_SECRETS_KEY",
  "NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "PORT", "PATH", "HOME",
  "VERCEL_TOKEN", "JAVARI_OPS_KEY", "OPS_API_BASE",
]);

let installed = false;

export function installEnvShim(): void {
  if (installed) return;
  installed = true;
  const realEnv = process.env;
  const proxy = new Proxy(realEnv, {
    get(target, prop: string | symbol): string | undefined {
      if (typeof prop !== "string") return Reflect.get(target, prop) as undefined;
      // Bootstrap + NEXT_PUBLIC_ always come from real env.
      if (BOOTSTRAP.has(prop) || prop.startsWith("NEXT_PUBLIC_")) {
        return target[prop];
      }
      // Real env wins if set (transition safety); otherwise vault cache.
      const real = target[prop];
      if (real !== undefined && real !== "") return real;
      const vault = getSecretSync(prop);
      return vault ?? real;
    },
    set(target, prop: string | symbol, value: string): boolean {
      return Reflect.set(target, prop, value);
    },
    has(target, prop: string | symbol): boolean {
      if (typeof prop === "string" && !BOOTSTRAP.has(prop) && getSecretSync(prop) !== null) return true;
      return Reflect.has(target, prop);
    },
  });
  try {
    // Replace the global reference so all process.env reads route through the proxy.
    (process as { env: NodeJS.ProcessEnv }).env = proxy;
  } catch {
    // Some runtimes freeze process.env; shim degrades to no-op (real env still works).
    installed = false;
  }
}

// The most-used secrets across the codebase — pre-warmed so shim reads are cache hits.
const WARM_KEYS = [
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

export async function warmEnvShim(): Promise<{ warmed: number; cache: { size: number } }> {
  const warmed = await warmSecrets(WARM_KEYS);
  return { warmed, cache: { size: cacheStats().size } };
}

export function envShimStatus(): { installed: boolean; cacheSize: number } {
  return { installed, cacheSize: cacheStats().size };
}

export default { installEnvShim, warmEnvShim, envShimStatus };
