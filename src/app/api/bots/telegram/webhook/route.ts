import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { getSettingBool } from "@/lib/config";
import { telegramConfig } from "@/lib/bots/config";
import { normalizeTelegramUpdate } from "@/lib/bots/telegram";
import { dispatchAndFinish } from "@/lib/bots/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram Bot API webhook.
 *
 * Always answers 200 (even when the bot is disabled) so Telegram does not retry
 * an update forever, and pushes generation results after the response when the
 * host can run background work.
 */
export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const cfg = await telegramConfig();

  if (cfg.webhookSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== cfg.webhookSecret) return new NextResponse("forbidden", { status: 403 });
  }

  const ack = NextResponse.json({ ok: true });
  if (!cfg.enabled) return ack;

  const update = await req.json().catch(() => null);
  if (!update) return ack;

  try {
    const inbound = await normalizeTelegramUpdate(update);
    if (!inbound) return ack;
    // Group chats: only react to explicit commands, so the bot stays quiet there.
    const isCommand = (inbound.text || "").trim().startsWith("/");
    if (inbound.isGroup && !isCommand) return ack;
    if (!(await getSettingBool("bots_enabled", true))) return ack;

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    await dispatchAndFinish(inbound, host);
  } catch (e) {
    console.error("[telegram/webhook]", e instanceof Error ? e.message : e);
  }
  return ack;
}

/** GET is handy for smoke-testing the route in a browser. */
export async function GET() {
  const cfg = await telegramConfig();
  return NextResponse.json({
    platform: "telegram",
    configured: !!cfg.token,
    enabled: cfg.enabled,
    username: cfg.botUsername || null,
    miniAppUrl: cfg.miniAppUrl || null,
  });
}
