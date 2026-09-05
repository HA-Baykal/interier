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
