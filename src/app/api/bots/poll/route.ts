import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { getSettingOrEnv } from "@/lib/config";
import { runPollCycle } from "@/lib/bots/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Long-polling entry point for Telegram + MAX.
 *
 * `npm run bots:poll` (or a cron call every ~30s) hits this endpoint on hosts
 * where a public webhook is not available. Guarded by BOT_POLL_SECRET so nobody
 * else can drive the bot.
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = (await getSettingOrEnv("bots_poll_secret", "BOT_POLL_SECRET")) || "";
  if (!secret) return process.env.NODE_ENV !== "production";
  const got = req.headers.get("x-poll-secret") || req.nextUrl.searchParams.get("secret") || "";
  return got === secret;
}

export async function POST(req: NextRequest) {
  await ensureBootSafe();
  if (!(await authorized(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const timeout = Number(req.nextUrl.searchParams.get("timeout") || 20);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    const result = await runPollCycle({ timeoutSec: Number.isFinite(timeout) ? timeout : 20, host });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
