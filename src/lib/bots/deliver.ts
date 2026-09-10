/**
 * Outbound delivery for Telegram.
 */

import { BotPlatform } from "../types";
import { BotOutbound } from "./types";
import { mutate } from "../db";

export type DeliverResult = { sent: number; lastMessageId: string | null };

export async function deliver(
  platform: BotPlatform = "telegram",
  chatId: string,
  outbounds: BotOutbound[],
  opts?: { isGroup?: boolean; progressStep?: string | null }
): Promise<DeliverResult> {
  let sent = 0;
  let lastMessageId: string | null = null;

  for (const out of outbounds) {
    if (!out.text && !out.photoUrl && !out.buttons?.length) continue;

    const { telegramSend } = await import("./telegram");
    const r = await telegramSend(chatId, out);
    if (r.messageId) lastMessageId = r.messageId;
    sent++;
  }

  if (lastMessageId && opts?.progressStep) {
    await mutate((d) => {
      const chat = d.botChats.find((c) => c.platform === "telegram" && c.chatId === String(chatId));
      if (chat) chat.progressMessageId = lastMessageId;
    });
  }

  return { sent, lastMessageId };
}

export function afterResponse(task: () => Promise<void>): void {
  void Promise.resolve()
    .then(task)
    .catch((e) => console.error("[bots] background task failed:", e instanceof Error ? e.message : e));
}

export async function isInlineGeneration(): Promise<boolean> {
  const { getSettingBool } = await import("../config");
  return getSettingBool("bots_inline_generation", false);
}

/** Deliver the results of a deferred task to the chat. */
export async function deliverTaskResult(
  platform: BotPlatform = "telegram",
  chatId: string,
  task: (() => Promise<BotOutbound[]>) | undefined,
  opts?: { isGroup?: boolean }
): Promise<void> {
  if (!task) return;
  const out = await task();
  if (out.length) await deliver("telegram", chatId, out, opts);
}
