import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { getSettingBool } from "@/lib/config";
import { handleBotUpdate } from "@/lib/bots/engine";
import { BotInbound } from "@/lib/bots/types";
import { BotPlatform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bot simulator — runs the real engine and returns what the messenger *would*
 * receive, without sending anything. Used by the admin panel ("Тест бота") and by
 * the repo smoke test, so bot flows stay verifiable without public webhooks.
 *
 * Enabled in development, or explicitly via the `bots_simulator` setting.
 */
async function allowed(): Promise<boolean> {
  if (await getSettingBool("bots_simulator", false)) return true;
  if (process.env.NODE_ENV !== "production") return true;
  // In production the admin session may open it (checked by the caller below).
  return false;
}

export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (!(await allowed())) {
    const { requireAdmin } = await import("@/lib/auth");
    try {
      await requireAdmin(req);
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const platform = (body.platform || "telegram") as BotPlatform;
  const inbound: BotInbound = {
    platform,
    chatId: String(body.chatId || "sim-chat"),
    externalId: String(body.externalId || body.chatId || "10001"),
    username: body.username ?? "simulator",
    displayName: body.displayName ?? "Simulator",
    locale: body.locale === "en" ? "en" : "ru",
    text: typeof body.text === "string" ? body.text : null,
    action: typeof body.action === "string" ? body.action : null,
    callbackId: null,
    photos: [],
  };

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    const reply = await handleBotUpdate(inbound, host);
    // The simulator executes the deferred generation too, so the answer is final.
    let tasks: unknown[] = [];
    if (reply.task) tasks = await reply.task();
    return NextResponse.json({
      ok: true,
      toast: reply.toast || null,
      messages: [...reply.messages, ...(tasks as never[])],
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
