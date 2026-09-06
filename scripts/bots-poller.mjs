#!/usr/bin/env node
/**
 * Bot transport worker: long polling for Telegram + MAX.
 *
 * Webhooks are the production default (POST /api/bots/telegram/webhook), but a
 * webhook needs a public HTTPS host. On a laptop, behind a plain-HTTP host or on
 * a MAX bot that has not been verified for HTTPS yet, run this worker instead: it
 * periodically calls POST /api/bots/poll on your server, which fetches updates
 * from the messengers and pushes the answers back — the same engine either way.
 *
 *   BOT_BASE_URL   server to drive (default http://127.0.0.1:3000)
 *   BOT_POLL_SECRET  must match the `bots_poll_secret` setting (admin panel)
 *   BOT_POLL_TIMEOUT seconds a poll request waits for updates (default 20)
 *   BOT_POLL_INTERVAL idle seconds between cycles (default 2)
 *
 *   npm run bots:poll            # keep running
 *   npm run bots:poll -- --once  # single cycle (for cron/systemd timers)
 */

const base = (process.env.BOT_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const secret = process.env.BOT_POLL_SECRET || "";
const timeout = Number(process.env.BOT_POLL_TIMEOUT || 20);
const interval = Math.max(0, Number(process.env.BOT_POLL_INTERVAL || 2));
const once = process.argv.includes("--once");

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  console.log("\n[bots] останавливаюсь…");
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function cycle() {
  const url = `${base}/api/bots/poll?timeout=${timeout}${secret ? `&secret=${encodeURIComponent(secret)}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: secret ? { "x-poll-secret": secret } : undefined,
    signal: AbortSignal.timeout((timeout + 45) * 1000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* html error page */
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${data?.error || text.slice(0, 160)}`);
  }
  return data?.result || {};
}

let backoff = 1;
let handled = 0;

while (!stopping) {
  try {
    const r = await cycle();
    backoff = 1;
    const tg = r.telegram?.count || 0;
    const mx = r.max?.count || 0;
    const errs = [r.telegram?.error && `telegram: ${r.telegram.error}`, r.max?.error && `max: ${r.max.error}`].filter(Boolean);
    handled += tg + mx;
    if (tg || mx || errs.length) {
      console.log(`[bots] telegram=${tg} max=${mx}${errs.length ? " ⚠ " + errs.join(" | ") : ""}`);
    }
    if (once) break;
    if (!tg && !mx) await sleep(interval * 1000);
  } catch (e) {
    console.error(`[bots] ${e.message} — повтор через ${backoff}s`);
    if (once) process.exit(1);
    await sleep(backoff * 1000);
    backoff = Math.min(60, backoff * 2);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (once) console.log(`[bots] готово: обработано обновлений ${handled}`);
