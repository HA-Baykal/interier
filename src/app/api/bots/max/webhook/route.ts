import { NextRequest, NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { getSettingBool } from "@/lib/config";
import { maxConfig } from "@/lib/bots/config";
import { normalizeMaxUpdate } from "@/lib/bots/max";
import { dispatchAndFinish } from "@/lib/bots/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MAX Bot API webhook (registered via POST /subscriptions on platform-api2.max.ru).
 *
 * MAX requires HTTPS with a valid certificate and sends `X-Max-Bot-Api-Secret`
 * when a secret was registered — anything else is rejected.
 */
export async function POST(req: NextRequest) {
  await ensureBootSafe();
  const cfg = await maxConfig();

  if (cfg.webhookSecret && req.headers.get("x-max-bot-api-secret") !== cfg.webhookSecret) {
    return new NextResponse("forbidden", { status: 403 });
  }

  // MAX retries 10 times and unsubscribes after 8h of failures → always 200.
  const ack = NextResponse.json({ success: true });
  if (!cfg.enabled || !(await getSettingBool("bots_enabled", true))) return ack;

  const update = await req.json().catch(() => null);
  if (!update) return ack;

  try {
    const inbound = await normalizeMaxUpdate(update);
    if (inbound) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      await dispatchAndFinish(inbound, host);
    }
  } catch (e) {
    console.error("[max/webhook]", e instanceof Error ? e.message : e);
  }
  return ack;
}

export async function GET() {
  const cfg = await maxConfig();
  return NextResponse.json({ platform: "max", configured: !!cfg.token, enabled: cfg.enabled, baseUrl: cfg.baseUrl });
}
