import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { getSetting, getSettingBool } from "@/lib/config";
import { vkConfig } from "@/lib/bots/config";
import { normalizeVkUpdate, verifyVkSignature } from "@/lib/bots/vk";
import { dispatchAndFinish } from "@/lib/bots/dispatch";
import { getChat } from "@/lib/bots/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * VK Callback API endpoint.
 *
 * Handles the `confirmation` challenge (VK asks for the token while you attach
 * the server) and `message_new` events. The response must be exactly `ok` for
 * every event, otherwise VK disables the callback server after a while.
 */
export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const cfg = await vkConfig();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("ok");
  }

  if (body?.type === "confirmation") {
    const token = (await getSetting("vk_confirmation_token")) || "";
    return new NextResponse(token || "error", { headers: { "Content-Type": "text/plain" } });
  }

  if (cfg.verifySignature && cfg.callbackSecret && body) {
    if (!verifyVkSignature(body, cfg.callbackSecret)) {
      console.warn("[vk] bad signature — ignoring (set vk_verify_signature=0 while debugging)");
      return new NextResponse("ok");
    }
    if (body.secret && cfg.callbackSecret && String(body.secret) !== cfg.callbackSecret) return new NextResponse("ok");
  }

  if (!cfg.enabled || !(await getSettingBool("bots_enabled", true))) return new NextResponse("ok");

  try {
    const peerId = body?.object?.peer_id ?? body?.object?.message?.peer_id;
    const stored = peerId ? await getChat("vk", String(peerId)) : null;
    const labels = ((stored?.extra as Record<string, unknown> | undefined)?.vkLabels || {}) as Record<string, string>;

    const inbound = await normalizeVkUpdate(body, labels);
    if (inbound) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      await dispatchAndFinish(inbound, host);
    }
  } catch (e) {
    console.error("[vk/webhook]", e instanceof Error ? e.message : e);
  }
  return new NextResponse("ok");
}

export async function GET() {
  const cfg = await vkConfig();
  return NextResponse.json({ platform: "vk", configured: !!cfg.token, enabled: cfg.enabled, groupId: cfg.groupId });
}
