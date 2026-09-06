/**
 * Long-polling worker for hosts where a public HTTPS webhook is inconvenient
 * (local dev, plain HTTP, or a bot that hasn't been verified on MAX yet).
 *
 * Telegram and MAX both expose long polling; VK does not for community bots, so
 * VK always uses the Callback API. Run it with `npm run bots:poll` — the loop
 * simply calls POST /api/bots/poll, which does the work below.
 */

import { getSetting, setSetting } from "../config";
import { BotInbound } from "./types";

export type PollCycleResult = {
  telegram: { count: number; error?: string };
  max: { count: number; error?: string };
};

export async function runPollCycle(opts?: { timeoutSec?: number; host?: string | null }): Promise<PollCycleResult> {
  const timeout = Math.min(60, Math.max(1, opts?.timeoutSec ?? 20));
  const out: PollCycleResult = { telegram: { count: 0 }, max: { count: 0 } };

  // ---- Telegram ----------------------------------------------------------
  try {
    const { telegramConfig } = await import("./config");
    const cfg = await telegramConfig();
    if (cfg.token) {
      const offsetRaw = await getSetting("tg_poll_offset");
      const offset = offsetRaw ? Number(offsetRaw) : 0;
      const { tgGetUpdates, normalizeTelegramUpdate } = await import("./telegram");
      const updates = await tgGetUpdates(offset || null, timeout);
      let maxId = offset || 0;
      for (const u of updates) {
        maxId = Math.max(maxId, Number(u.update_id || 0));
        const inbound = await normalizeTelegramUpdate(u);
        if (inbound) await handle(inbound, opts?.host || null);
      }
      if (maxId) await setSetting("tg_poll_offset", String(maxId));
      out.telegram.count = updates.length;
    }
  } catch (e) {
    out.telegram.error = e instanceof Error ? e.message : String(e);
  }

  // ---- MAX ---------------------------------------------------------------
  try {
    const { maxConfig } = await import("./config");
    const cfg = await maxConfig();
    if (cfg.token) {
      const marker = (await getSetting("max_poll_marker")) || null;
      const { maxGetUpdates, normalizeMaxUpdate } = await import("./max");
      const r = await maxGetUpdates(marker, timeout);
      for (const u of r.updates || []) {
        const inbound = await normalizeMaxUpdate(u);
        if (inbound) await handle(inbound, opts?.host || null);
      }
      if (r.marker) await setSetting("max_poll_marker", String(r.marker));
      out.max.count = (r.updates || []).length;
    }
  } catch (e) {
    out.max.error = e instanceof Error ? e.message : String(e);
  }

  return out;
}

async function handle(inbound: BotInbound, host: string | null): Promise<void> {
  const { dispatchInbound } = await import("./dispatch");
  const { runTask } = await dispatchInbound(inbound, host);
  // The poller is a background loop: generations run to completion here.
  await runTask();
}
