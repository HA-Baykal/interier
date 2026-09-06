import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { handleBotUpdate } from "@/lib/bots/engine";
import { BotInbound } from "@/lib/bots/types";
import { BotPlatform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { platform, chatId?, text?|action? } — run the engine in a sandbox and
 * return the exact payloads the bot would show (nothing is sent to users).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const inbound: BotInbound = {
    platform: (body.platform || "telegram") as BotPlatform,
    chatId: String(body.chatId || `admin-test-${Date.now()}`),
    externalId: String(body.externalId || `admin-test-${Date.now()}`),
    username: "admin_test",
    displayName: "Admin test",
    locale: body.locale === "en" ? "en" : "ru",
    text: typeof body.text === "string" ? body.text : null,
    action: typeof body.action === "string" ? body.action : null,
    photos: [],
  };
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const reply = await handleBotUpdate(inbound, host);
  const task = reply.task ? await reply.task() : [];
  return NextResponse.json({ ok: true, toast: reply.toast || null, messages: [...reply.messages, ...task] });
}
