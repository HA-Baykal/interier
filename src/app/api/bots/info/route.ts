import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { appUrl, telegramConfig } from "@/lib/bots/config";
import { webhookPath } from "@/lib/bots/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public bot info for the website.
 */
export async function GET(req: NextRequest) {
  await ensureBootSafe();
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const [tg, app] = await Promise.all([
    telegramConfig(),
    appUrl(host),
  ]);

  const platforms = [
    {
      platform: "telegram" as const,
      connected: tg.enabled,
      username: tg.botUsername,
      startUrl: tg.botUsername ? `https://t.me/${tg.botUsername}` : null,
      hasMiniApp: true,
      webhookPath: webhookPath("telegram"),
    },
  ];

  return NextResponse.json({ appUrl: app, platforms });
}
