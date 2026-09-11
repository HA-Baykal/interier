import { NextRequest, NextResponse } from "next/server";
import { handleYooKassaWebhookEvent } from "@/lib/yookassa";
import { safeErrorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "missing_body" }, { status: 400 });
    }

    const result = await handleYooKassaWebhookEvent(body);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[YooKassa Webhook Error]", e);
    const message = safeErrorMessage(e);
    return NextResponse.json({ error: "webhook_error", message }, { status: 500 });
  }
}
