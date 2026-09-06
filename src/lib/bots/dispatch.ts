/**
 * Shared dispatch: inbound update → engine → platform reply, with the long
 * generation deliberately deferred so webhooks answer instantly.
 */

import { getSettingBool } from "../config";
import { BotInbound, BotReply } from "./types";
import { deliver } from "./deliver";
import { updateChat } from "./store";
import { db } from "../db";

export type DispatchResult = { reply: BotReply; sent: number; runTask: () => Promise<void> };

export async function dispatchInbound(inbound: BotInbound, hostHint?: string | null): Promise<DispatchResult> {
  // In a group the bot only serves chats it was explicitly attached to: an
  // unrelated group must not be able to create accounts or spend credits.
  if (inbound.isGroup && !(inbound.text || "").trim().startsWith("/")) {
    const chat = (await db()).botChats.find((c) => c.platform === inbound.platform && c.chatId === String(inbound.chatId));
    if (!chat?.userId) return { reply: { messages: [] }, sent: 0, runTask: async () => {} };
  }

  const reply = await (await import("./engine")).handleBotUpdate(inbound, hostHint);

  // 1. Kill the button spinner / show the toast right away.
  if (inbound.platform === "telegram" && inbound.callbackId) {
    const { answerCallback } = await import("./telegram");
    await answerCallback(inbound.callbackId, reply.toast || undefined);
  } else if (inbound.platform === "max" && inbound.callbackId) {
    const { maxAnswerCallback } = await import("./max");
    await maxAnswerCallback(inbound.callbackId, reply.toast || undefined);
  }

  // 2. Immediate messages (menu, "generating…", errors).
  let sent = 0;
  if (reply.messages.length) {
    const r = await deliver(inbound.platform, inbound.chatId, reply.messages, { isGroup: inbound.isGroup });
    sent = r.sent;
    const chat = (await db()).botChats.find((c) => c.platform === inbound.platform && c.chatId === String(inbound.chatId));
    if (r.lastMessageId && chat?.step === "running") {
      await updateChat(inbound.platform, String(inbound.chatId), { progressMessageId: r.lastMessageId });
    }
  }

  // 3. Generation work.
  const runTask = async (): Promise<void> => {
    if (!reply.task) return;
    try {
      const out = await reply.task();
      if (out.length) await deliver(inbound.platform, inbound.chatId, out, { isGroup: inbound.isGroup });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[bots] task failed:", message);
      await updateChat(inbound.platform, String(inbound.chatId), { step: "idle", lastError: message.slice(0, 300) });
      await deliver(inbound.platform, inbound.chatId, [
        { text: `⚠️ ${message.slice(0, 300)}` },
      ]).catch(() => undefined);
    }
  };

  return { reply, sent, runTask };
}

/** Webhook helper: await the task when the host is serverless, else background it. */
export async function dispatchAndFinish(inbound: BotInbound, hostHint?: string | null): Promise<{ sent: number; mode: "inline" | "background" }> {
  const { sent, runTask } = await dispatchInbound(inbound, hostHint);
  const inline = await getSettingBool("bots_inline_generation", false);
  if (inline) {
    await runTask();
    return { sent, mode: "inline" };
  }
  void Promise.resolve()
    .then(runTask)
    .catch((e) => console.error("[bots] background task failed:", e instanceof Error ? e.message : e));
  return { sent, mode: "background" };
}
