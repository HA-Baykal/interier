#!/usr/bin/env node
/**
 * Bot transport worker: long polling for Telegram.
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
    const errs = [r.telegram?.error && `telegram: ${r.telegram.error}`].filter(Boolean);
    handled += tg;
    if (tg || errs.length) {
      console.log(`[bots] telegram=${tg}${errs.length ? " ⚠ " + errs.join(" | ") : ""}`);
    }
    if (once) break;
    if (!tg) await sleep(interval * 1000);
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
