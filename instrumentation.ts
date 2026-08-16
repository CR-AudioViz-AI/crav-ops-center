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
}
