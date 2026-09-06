import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/config";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }

  const d = await db();
  const [generation_mode, free_credits, reward_telegram, reward_vk, reward_referral, test_unlimited] =
    await Promise.all([
      getSetting("generation_mode"),
      getSetting("free_credits"),
      getSetting("reward_telegram"),
      getSetting("reward_vk"),
      getSetting("reward_referral"),
      getSetting("test_unlimited"),
    ]);
  const [compatible_provider, compatible_base_url, compatible_api_key, compatible_model] =
    await Promise.all([
      getSetting("compatible_provider"),
      getSetting("compatible_base_url"),
      getSetting("compatible_api_key"),
      getSetting("compatible_model"),
    ]);

  const CORE_KEYS = ["generation_mode", "free_credits", "reward_telegram", "reward_vk", "reward_referral", "test_unlimited"];
  const extraKeys = ALLOWED.filter((k) => !k.startsWith("compatible_") && !CORE_KEYS.includes(k));
  const extra: Record<string, string> = {};
  for (const k of extraKeys) extra[k] = (await getSetting(k)) || "";

  const base = compatible_base_url || process.env.COMPATIBLE_BASE_URL || "https://api.gen-api.ru";
  const key = compatible_api_key || process.env.COMPATIBLE_API_KEY || "";
  const model = compatible_model || process.env.COMPATIBLE_MODEL || "gpt-image-2";

  return NextResponse.json({
    settings: {
      generation_mode: generation_mode || "demo",
      free_credits: free_credits || "0",
      reward_telegram: reward_telegram || "1",
      reward_vk: reward_vk || "1",
      reward_referral: reward_referral || "1",
      test_unlimited: test_unlimited || "1",
      compatible_provider: compatible_provider || "genapi",
      compatible_base_url: base,
      compatible_api_key: key,
      compatible_model: model,
      compatible_configured: !!(base && key && model),
      ...extra,
    },
    stats: {
      users: d.users.length,
      generations: d.generations.length,
      credits: d.users.reduce((a, u) => a + u.credits, 0),
      referrals: d.referrals.filter((r) => r.rewarded).length,
    },
    env: {
      hasReplicate: !!process.env.REPLICATE_API_TOKEN,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasTogether: !!process.env.TOGETHER_API_KEY || !!process.env.FAL_API_KEY,
    },
  });
}

const ALLOWED = [
  "generation_mode",
  "free_credits",
  "reward_telegram",
  "reward_vk",
  "reward_referral",
  "test_unlimited",
  "compatible_provider",
  "compatible_base_url",
  "compatible_api_key",
  "compatible_model",
  // Shopping list (interior details → marketplace links)
  "shopping_enabled",
  "shopping_auto",
  "shopping_max_items",
  "shopping_marketplaces",
  "shopping_extra_params",
  "shopping_default_mode",
  "shopping_public_links",
  // AI detail detector
  "vision_enabled",
  "vision_provider",
  "vision_base_url",
  "vision_api_key",
  "vision_model",
  // Bots & messenger apps
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
  "vk_group_id",
  "vk_access_token",
  "vk_callback_secret",
  "vk_confirmation_token",
  "vk_verify_signature",
  "vk_mini_app_id",
  "vk_app_verify_token",
  "max_bot_token",
  "max_base_url",
  "max_webhook_secret",
  // Marketing channels shown in the bot menu
  "channel_telegram_url",
  "channel_vk_url",
  "channel_max_url",
];

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  for (const key of ALLOWED) {
    if (key in body && typeof body[key] === "string") {
      await setSetting(key, body[key].trim());
    }
  }

  return NextResponse.json({ ok: true });
}
