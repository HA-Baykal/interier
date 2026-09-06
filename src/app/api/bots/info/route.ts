import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { appUrl, telegramConfig, vkConfig } from "@/lib/bots/config";
import { getSetting } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public "which messengers can you use us from" info for the website.
 *
 * Deliberately exposes nothing but usernames and links — tokens, webhook secrets
 * and chat ids stay inside the admin endpoints.
 */
export async function GET(req: NextRequest) {
  await ensureBootSafe();
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const [tg, vk, maxToken, app] = await Promise.all([
    telegramConfig(),
    vkConfig(),
    getSetting("max_bot_token"),
    appUrl(host),
  ]);
  const maxUsername = (await getSetting("max_bot_username")) || "";

  const platforms = [
    {
      platform: "telegram" as const,
      connected: tg.enabled,
      username: tg.botUsername,
      startUrl: tg.botUsername ? `https://t.me/${tg.botUsername}` : null,
      hasMiniApp: true,
    },
    {
      platform: "vk" as const,
      connected: vk.enabled,
      username: vk.groupId ? `id${vk.groupId}` : null,
      startUrl: vk.groupId ? `https://vk.com/im?sel=-${vk.groupId}` : null,
      hasMiniApp: false,
    },
    {
      platform: "max" as const,
      connected: !!maxToken,
      username: maxUsername || null,
      startUrl: maxUsername ? `https://max.ru/${maxUsername}` : null,
      hasMiniApp: false,
    },
  ];

  return NextResponse.json({ appUrl: app, platforms });
}
