import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { setupPlatform, syncAllWebhooks } from "@/lib/bots/setup";
import { BotPlatform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { platform?: "telegram"|"vk"|"max" } — register webhooks / menu button. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => null);
  const platform = body?.platform as BotPlatform | undefined;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    const result = platform ? { [platform]: await setupPlatform(platform, host) } : await syncAllWebhooks(host);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
