/**
 * Long-polling worker for Telegram.
 */

import { getSetting, setSetting } from "../config";
import { BotInbound } from "./types";

export type PollCycleResult = {
  telegram: { count: number; error?: string };
};

export async function runPollCycle(opts?: { timeoutSec?: number; host?: string | null }): Promise<PollCycleResult> {
  const timeout = Math.min(60, Math.max(1, opts?.timeoutSec ?? 20));
  const out: PollCycleResult = { telegram: { count: 0 } };

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

  return out;
}

async function handle(inbound: BotInbound, host: string | null): Promise<void> {
  const { dispatchInbound } = await import("./dispatch");
  const { runTask } = await dispatchInbound(inbound, host);
  await runTask();
}
