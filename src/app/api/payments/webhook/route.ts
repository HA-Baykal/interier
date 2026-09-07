import { NextRequest, NextResponse } from "next/server";
import { mutate } from "@/lib/db";
import { addCredits } from "@/lib/billing";
import { paymentsConfig, verifyYooSignature, getYooPaymentStatus } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * YooKassa notifications. We answer 200 fast; credits are granted exactly once
 * per payment (idempotent by yookassaId + status) and ONLY after the YooKassa
 * API confirms the payment really succeeded — so a forged/replayed webhook can
 * never grant credits. The signature header, when present, is verified too.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const { secret } = await paymentsConfig();
  const signature = req.headers.get("x-yookassa-signature") || "";
  // Soft signature check: if YooKassa sent a signature it must be valid; if it
  // sent none we still proceed because the API check below is the source of truth.
  if (signature && secret && !verifyYooSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const event = JSON.parse(raw || "{}");
  const type: string = event?.type || "";
  const obj = event?.object || {};
  const yookassaId: string = obj?.id || "";
  if (!yookassaId) return NextResponse.json({ ok: true });

  if (type === "payment.succeeded") {
    // Trust, but verify: ask YooKassa for the payment before crediting.
    const status = await getYooPaymentStatus(yookassaId);
    if (status !== "succeeded") return NextResponse.json({ ok: true, verified: false });
    const target = await mutate<{ userId: string; credits: number } | null>((d) => {
      const p = d.payments.find((x) => x.yookassaId === yookassaId);
      if (!p || p.status === "paid") return null; // already granted — idempotent
      p.status = "paid";
      return { userId: p.userId, credits: p.credits };
    });
    if (target) await addCredits(target.userId, target.credits);
  } else if (type === "payment.canceled") {
    await mutate((d) => {
      const p = d.payments.find((x) => x.yookassaId === yookassaId);
      if (p && p.status === "pending") p.status = "failed";
    });
  }
  return NextResponse.json({ ok: true });
}
