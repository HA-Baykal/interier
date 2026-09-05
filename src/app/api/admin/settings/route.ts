import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getSetting, setSetting, generationMode } from "@/lib/config";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }

  const d = db();
  return NextResponse.json({
    settings: {
      generation_mode: getSetting("generation_mode") || "demo",
      free_credits: getSetting("free_credits") || "0",
      reward_telegram: getSetting("reward_telegram") || "1",
      reward_vk: getSetting("reward_vk") || "1",
      reward_referral: getSetting("reward_referral") || "1",
      test_unlimited: getSetting("test_unlimited") || "1",
      compatible_base_url: getSetting("compatible_base_url") || process.env.COMPATIBLE_BASE_URL || "",
      compatible_api_key: getSetting("compatible_api_key") || process.env.COMPATIBLE_API_KEY || "",
      compatible_model: getSetting("compatible_model") || process.env.COMPATIBLE_MODEL || "google/nano-banana",
      compatible_configured: !!(
        (getSetting("compatible_base_url") || process.env.COMPATIBLE_BASE_URL) &&
        (getSetting("compatible_api_key") || process.env.COMPATIBLE_API_KEY) &&
        (getSetting("compatible_model") || process.env.COMPATIBLE_MODEL)
      ),
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
  "compatible_base_url",
  "compatible_api_key",
  "compatible_model",
];

export async function PUT(req: NextRequest) {
  try {
    requireAdmin(req);
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
      setSetting(key, body[key].trim());
    }
  }

  return NextResponse.json({ ok: true });
}
