/**
 * instrumentation.ts — javari-ops.
 *
 * 2026-08-30: split to Next's documented runtime pattern. The Node-only work,
 * including this repo's deliberate vault-then-Sentry ordering, lives in
 * ./instrumentation-node.
 *
 * CR AudioViz AI, LLC · EIN 39-3646201
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
