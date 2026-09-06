/**
 * Outbound delivery for all three messengers.
 *
 * The engine produces platform-neutral messages; this layer serializes them,
 * remembers the id of the last "progress" message (so a long generation can
 * update one bubble instead of spamming the chat) and keeps the VK label map in
 * sync so button presses always resolve.
 */

import { BotPlatform } from "../types";
import { BotOutbound } from "./types";
import { updateChat } from "./store";
import { db, mutate } from "../db";

export type DeliverResult = { sent: number; lastMessageId: string | null };

export async function deliver(
  platform: BotPlatform,
  chatId: string,
  outbounds: BotOutbound[],
  opts?: { isGroup?: boolean; progressStep?: string | null }
): Promise<DeliverResult> {
  let sent = 0;
  let lastMessageId: string | null = null;

  for (const out of outbounds) {
    if (!out.text && !out.photoUrl && !out.buttons?.length) continue;

    if (platform === "telegram") {
      const { telegramSend } = await import("./telegram");
      const r = await telegramSend(chatId, out);
      if (r.messageId) lastMessageId = r.messageId;
      sent++;
    } else if (platform === "vk") {
      const { vkSend } = await import("./vk");
      const current = (await db()).botChats.find((c) => c.platform === "vk" && c.chatId === String(chatId));
      const prev = ((current?.extra as Record<string, unknown> | undefined)?.vkLabels || {}) as Record<string, string>;
      const labels = { ...prev };
      const r = await vkSend(chatId, out, labels);
      if (Object.keys(labels).length !== Object.keys(prev).length) {
        await updateChat("vk", String(chatId), { extra: { ...(current?.extra || {}), vkLabels: labels } });
      }
      if (r.messageId) lastMessageId = r.messageId;
      sent++;
    } else {
      const { maxSend } = await import("./max");
      const r = await maxSend(chatId, out, { isGroup: opts?.isGroup });
      if (r.messageId) lastMessageId = r.messageId;
      sent++;
    }
  }

  if (lastMessageId && opts?.progressStep) {
    await mutate((d) => {
      const chat = d.botChats.find((c) => c.platform === platform && c.chatId === String(chatId));
      if (chat) chat.progressMessageId = lastMessageId;
    });
  }

  return { sent, lastMessageId };
}

/**
 * Run engine work after the webhook response has been flushed.
 *
 * A real generation can take minutes; Telegram/VK/MAX expect a quick 200. On a
 * persistent host (Render, VPS, Docker) the returned promise keeps running in the
 * same process, so we answer first and push the result into the chat when done.
 * On serverless hosts the admin can switch `bots_inline_generation` on instead.
 */
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
  platform: BotPlatform,
  chatId: string,
  task: (() => Promise<BotOutbound[]>) | undefined,
  opts?: { isGroup?: boolean }
): Promise<void> {
  if (!task) return;
  const out = await task();
  if (out.length) await deliver(platform, chatId, out, opts);
}
