/**
 * instrumentation-node.ts
 *
 * 2026-08-30. The Node-only half, merged rather than overwritten.
 *
 * javari-ops initialises Sentry AFTER the vault, and that ordering is deliberate:
 * the DSN lives in the vault, so initialising first would read an un-hydrated env,
 * get no DSN, and report nothing while appearing configured. Preserved exactly.
 *
 * Its Sentry import is also WRAPPED, with a comment recording why: "a monitoring
 * tool must never take the platform down. My first attempt at this on core was
 * unguarded and every page 500'd." Preserved.
 *
 * WHAT CHANGED: hydration is AWAITED HERE, unlike the other 52 repos, precisely
 * because of that ordering — Sentry needs the DSN before it initialises. So the
 * await is kept but scoped to this file, and it is bounded by a timeout so a slow
 * vault degrades Sentry rather than the server. register() is awaited by Next and
 * an unbounded wait there means the server accepts no requests at all.
 *
 * CR AudioViz AI, LLC · EIN 39-3646201
 */

const HYDRATION_TIMEOUT_MS = 4000;

export async function registerNode(): Promise<void> {
  try {
    const { installEnvShim } = await import("@/lib/platform-secrets/env-shim");
    // Bounded. A vault that will not answer costs Sentry its DSN, not the server
    // its ability to serve — which is the trade this whole rework exists to make.
    await Promise.race([
      installEnvShim(),
      new Promise((resolve) => setTimeout(resolve, HYDRATION_TIMEOUT_MS)),
    ]);
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: "WARN",
        event: "ENV_HYDRATION_FAILED",
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  // AFTER hydration, deliberately: the DSN lives in the vault. Wrapped, because a
  // monitoring tool must never take the platform down.
  try {
    await import("./sentry.server.config");
  } catch (e) {
    console.warn(
      JSON.stringify({
        level: "WARN",
        event: "SENTRY_INIT_FAILED",
        message: e instanceof Error ? e.message : "unknown",
      }),
    );
  }
}
