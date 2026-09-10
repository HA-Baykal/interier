import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/config";
import { botsStatus } from "@/lib/bots/setup";
import { botStats } from "@/lib/bots/store";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS = [
  "bots_enabled",
  "bots_inline_generation",
  "bots_simulator",
  "bots_poll_secret",
  "bots_link_ttl_min",
  "public_base_url",
  "admin_telegram_id",
  "telegram_bot_token",
  "telegram_bot_username",
  "telegram_mini_app_url",
  "telegram_webhook_secret",
  "telegram_channel_id",
  "channel_telegram_url",
];

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

/** Telegram Bot configuration + live status (tokens are returned masked). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const [status, stats, d] = await Promise.all([botsStatus(host), botStats(), db()]);
  const settings: Record<string, string> = {};
  for (const k of KEYS) settings[k] = (await getSetting(k)) || "";
  return NextResponse.json({
    ...status,
    stats,
    chats: d.botChats.slice(-20).map((c) => ({
      platform: c.platform,
      chatId: c.chatId,
      user: c.displayName || c.username || c.externalId,
      step: c.step,
      linked: !!c.userId,
      updatedAt: c.updatedAt,
    })),
    settings: KEYS.map((k) => ({ key: k, value: k.includes("token") || k.includes("secret") ? mask(settings[k]) : settings[k], set: !!settings[k] })),
    raw: settings,
  });
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const changed: string[] = [];
  for (const k of KEYS) {
    if (!(k in body)) continue;
    const v = typeof body[k] === "string" ? body[k].trim() : String(body[k] ?? "").trim();
    if (v.includes("…")) continue;
    await setSetting(k, v);
    changed.push(k);
  }
  return NextResponse.json({ ok: true, changed });
}
