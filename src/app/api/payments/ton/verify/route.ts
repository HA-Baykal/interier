import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { verifyTonPayment } from "@/lib/payments-ton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Check whether the buyer's TON transfer arrived on-chain and grant credits.
 * The Mini App calls this after the wallet confirms the send (and may poll it).
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  const body = await req.json().catch(() => ({}));
  const paymentId = String((body as any)?.paymentId || "");
  const result = await verifyTonPayment(paymentId);
  return NextResponse.json({ ok: true, ...result });
}
