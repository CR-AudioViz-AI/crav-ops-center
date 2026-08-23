// instrumentation.ts
// CR AudioViz AI — Server startup hook. Installs the vault env-shim so every
// process.env.<SECRET> read across the platform returns the vault value.
// Runs once per server instance (Next.js instrumentation). 2026-07-13
export async function register(): Promise<void> {
  // Only in the Node.js server runtime (not edge, not browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { installEnvShim, warmEnvShim } = await import("@/lib/platform-secrets/env-shim");
    installEnvShim();
    await warmEnvShim();
    console.log(JSON.stringify({ level: "INFO", event: "ENV_SHIM_READY" }));
  } catch (e) {
    console.warn(JSON.stringify({ level: "WARN", event: "ENV_SHIM_FAILED", message: e instanceof Error ? e.message : "unknown" }));
  }

  // 2026-08-26: Sentry initialised AFTER the vault shim - the DSN lives in the
  // vault, so initialising first would read an un-shimmed env, get no DSN, and
  // report nothing while appearing configured.
  //
  // WRAPPED: a monitoring tool must never take the platform down. My first
  // attempt at this on core was unguarded and every page 500'd.
  try {
    await import("./sentry.server.config");
  } catch (e) {
    console.warn(JSON.stringify({ level: "WARN", event: "SENTRY_INIT_FAILED",
      message: e instanceof Error ? e.message : "unknown" }));
  }
}
