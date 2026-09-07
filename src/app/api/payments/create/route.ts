import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db, mutate, uid, now } from "@/lib/db";
import { createYooPayment, paymentsConfig } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a YooKassa payment for a package and return the redirect URL. */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  const cfg = await paymentsConfig();
  if (!cfg.configured) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const packageId = String(body?.packageId || "");
  const pack = (await db()).packages.find((p) => p.id === packageId && p.active);
  if (!pack) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const origin = req.headers.get("x-forwarded-origin") || `https://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
  try {
    const payment = await createYooPayment({
      amountRub: pack.price,
      description: `Interier — ${pack.name.ru} (${pack.credits} генераций)`,
      returnUrl: `${origin}/account?paid=1`,
      metadata: { userId: user.id, packageId: pack.id, credits: String(pack.credits) },
    });
    await mutate((d) => {
      d.payments.push({
        id: uid("pay"),
        yookassaId: payment.id,
        userId: user.id,
        packageId: pack.id,
        amountRub: pack.price,
        credits: pack.credits,
        status: "pending",
        createdAt: now(),
      });
    });
    return NextResponse.json({ ok: true, confirmationUrl: payment.confirmationUrl });
  } catch (e) {
    return NextResponse.json({ error: "payment_failed", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
