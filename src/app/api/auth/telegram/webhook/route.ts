import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual, telegramConfig, telegramScopeHash } from "@/lib/telegram/config";
import { handleTelegramAuthUpdate } from "@/lib/telegram/login";
import { authFailure, privateHeaders } from "@/lib/auth-response";
import { RequestError } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET() {
  return NextResponse.json({ service: "interier-telegram-auth", scope: telegramScopeHash() }, { headers: privateHeaders });
}
export async function POST(req: NextRequest) {
  try {
    const cfg = telegramConfig();
    // Check before parsing the body or touching account/challenge storage.
    if (!constantTimeEqual(req.headers.get("x-telegram-bot-api-secret-token") || "", cfg.webhookSecret)) {
      throw new RequestError("invalid_webhook_secret", "Unauthorized webhook", 401);
    }
    if (Number(req.headers.get("content-length")) > 256 * 1024) throw new RequestError("bad_request", "Update too large", 413);
    const text = await req.text();
    if (Buffer.byteLength(text) > 256 * 1024) throw new RequestError("bad_request", "Update too large", 413);
    let update: unknown;
    try { update = JSON.parse(text); } catch { throw new RequestError("bad_request", "Invalid update"); }
    await handleTelegramAuthUpdate(update);
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (e) { return authFailure(e); }
}
