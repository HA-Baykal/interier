import { NextRequest, NextResponse } from "next/server";
import { telegramScopeHash } from "@/lib/telegram/config";
import { handleTelegramAuthUpdate } from "@/lib/telegram/login";
import { assertTelegramWebhookAuthorized } from "@/lib/telegram/webhook-auth";
import { authFailure, privateHeaders } from "@/lib/auth-response";
import { RequestError } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A design request that arrives from a chat is finished inside this request on
// serverless hosts (bots_inline_generation=1), so it needs the image budget.
export const maxDuration = 300;
export async function GET() {
  return NextResponse.json({ service: "interier-telegram-auth", scope: telegramScopeHash() }, { headers: privateHeaders });
}
export async function POST(req: NextRequest) {
  try {
    // Check before parsing the body or touching account/challenge storage.
    // Both the login transport and the bot application share this URL, so the
    // secret may come either from the environment-derived value or from the one
    // minted in the admin panel.
    await assertTelegramWebhookAuthorized(req);
    if (Number(req.headers.get("content-length")) > 256 * 1024) throw new RequestError("bad_request", "Update too large", 413);
    const text = await req.text();
    if (Buffer.byteLength(text) > 256 * 1024) throw new RequestError("bad_request", "Update too large", 413);
    let update: unknown;
    try { update = JSON.parse(text); } catch { throw new RequestError("bad_request", "Invalid update"); }
    const handledByLogin = await handleTelegramAuthUpdate(update);
    // Everything that is not a login confirmation is the bot application:
    // menu, styles, photo analysis, surgical edits, shopping links, history.
    if (!handledByLogin) {
      const { dispatchTelegramWebhook } = await import("@/lib/bots/telegram-webhook");
      await dispatchTelegramWebhook(req, update);
    }
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (e) { return authFailure(e); }
}
