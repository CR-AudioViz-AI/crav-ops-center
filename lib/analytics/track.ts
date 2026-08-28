import { secretKey, supabaseUrl } from "@craudioviz/platform-sdk";
// lib/analytics/track.ts — log every visit, human or machine
//
// analytics_events and analytics_sessions were designed and left empty: schema
// with no collector. Roy's requirement is that anyone or anything that visits
// gets logged, so the platform knows how much of its traffic is real before it
// starts selling agent exclusivity on the number.
//
// Three decisions worth naming:
//
//   IP IS HASHED, NEVER STORED RAW. A raw IP is personal data under GDPR and
//   CCPA and buys nothing a salted hash does not — unique-visitor counts,
//   abuse detection and rate limiting all work on the hash. The salt lives in
//   the vault, so the hashes cannot be reversed with a rainbow table.
//
//   BOTS ARE COUNTED, NOT BLOCKED. A traffic figure that silently includes
//   GPTBot and AhrefsBot is a lie told to yourself. Every row carries is_bot
//   and the crawler's name, so "12,000 visits" can always be split into humans
//   and machines.
//
//   LOGGING NEVER BLOCKS THE RESPONSE. Every call is fire-and-forget and every
//   failure is swallowed. A visitor must never wait on analytics, and an
//   analytics outage must never take a page down.
//
// CR AudioViz AI, LLC · EIN 39-3646201 · August 2026
// Web Crypto, not node:crypto. This runs in Edge middleware where
// createHash does not exist — a detail that compiles fine and fails at
// runtime, which is the worst way to find it.

// Matched in order; first hit wins. Names are the ones the operators publish.
const BOTS: [RegExp, string][] = [
  [/GPTBot/i, "GPTBot"],
  [/ChatGPT-User/i, "ChatGPT-User"],
  [/OAI-SearchBot/i, "OAI-SearchBot"],
  [/ClaudeBot|Claude-Web|anthropic-ai/i, "ClaudeBot"],
  [/PerplexityBot/i, "PerplexityBot"],
  [/Google-Extended/i, "Google-Extended"],
  [/Googlebot/i, "Googlebot"],
  [/bingbot|BingPreview/i, "Bingbot"],
  [/DuckDuckBot/i, "DuckDuckBot"],
  [/Baiduspider/i, "Baiduspider"],
  [/YandexBot/i, "YandexBot"],
  [/Applebot/i, "Applebot"],
  [/facebookexternalhit|meta-externalagent/i, "Meta"],
  [/Twitterbot/i, "Twitterbot"],
  [/LinkedInBot/i, "LinkedInBot"],
  [/Slackbot/i, "Slackbot"],
  [/Discordbot/i, "Discordbot"],
  [/WhatsApp/i, "WhatsApp"],
  [/TelegramBot/i, "TelegramBot"],
  [/AhrefsBot/i, "AhrefsBot"],
  [/SemrushBot/i, "SemrushBot"],
  [/MJ12bot/i, "MJ12bot"],
  [/DotBot/i, "DotBot"],
  [/PetalBot/i, "PetalBot"],
  [/Bytespider/i, "Bytespider"],
  [/CCBot/i, "CCBot"],
  [/UptimeRobot|Pingdom|StatusCake/i, "uptime monitor"],
  [/curl|wget|python-requests|axios|Go-http-client|okhttp|libwww/i, "script"],
  [/HeadlessChrome|Puppeteer|Playwright|PhantomJS/i, "headless browser"],
  // Deliberately last: catches crawlers not named above without mislabelling
  // the ones that are.
  [/bot|crawler|spider|scraper/i, "unclassified bot"],
];

export interface Visit {
  path: string;
  method: string;
  userAgent: string;
  referrer: string | null;
  ip: string | null;
  country: string | null;
  appId: string;
  sessionId: string | null;
  userId: string | null;
  status?: number;
}

export function classifyBot(ua: string): { isBot: boolean; name: string | null } {
  if (!ua) return { isBot: true, name: "no user agent" };
  for (const [re, name] of BOTS) {
    if (re.test(ua)) return { isBot: true, name };
  }
  return { isBot: false, name: null };
}

export function deviceType(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  if (!ua) return "unknown";
  return "desktop";
}

/** Salted hash via Web Crypto, so it works in Edge and Node alike. */
export async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const salt = process.env.ANALYTICS_IP_SALT ?? process.env.NEXTAUTH_SECRET ?? "";
  if (!salt) return null;
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * Fire and forget. Returns immediately; the caller never awaits a database
 * write to serve a page.
 */
export async function track(v: Visit): Promise<void> {
  const url = supabaseUrl();
  const key = secretKey();
  if (!url || !key) return;

  const bot = classifyBot(v.userAgent);
  const row = {
    event_type: "pageview",
    event_name: "pageview",
    app_id: v.appId,
    path: v.path,
    page_url: v.path,
    method: v.method,
    status: v.status ?? null,
    referrer: v.referrer,
    user_agent: v.userAgent ? v.userAgent.slice(0, 400) : null,
    // Raw IP is never written. ip_hash is the column that matters.
    ip_hash: await hashIp(v.ip),
    country: v.country,
    device_type: deviceType(v.userAgent),
    is_bot: bot.isBot,
    bot_name: bot.name,
    session_id: v.sessionId,
    user_id: v.userId,
  };

  // 2026-08-16: this was `void fetch(...)`, so track() returned instantly and
  // the fetch was detached. event.waitUntil(track(...)) then waited on a promise
  // that had already resolved, and Edge killed the invocation before the write
  // landed — 44 apps deployed clean and logged nothing. Returning the promise is
  // what makes waitUntil able to hold the invocation open for it.
  await fetch(`${url}/rest/v1/analytics_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
    // Short timeout: analytics is never worth holding a request open for.
    signal: AbortSignal.timeout(3000),
    cache: "no-store",
  }).catch(() => {
    // Swallowed on purpose. An analytics outage must not take a page down.
  });
}
