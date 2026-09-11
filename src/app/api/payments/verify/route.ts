import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { verifyAndSettlePayment } from "@/lib/yookassa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const paymentId = body.paymentId || body.id;
    if (!paymentId) {
      return NextResponse.json({ error: "missing_id" }, { status: 400 });
    }
    const result = await verifyAndSettlePayment(paymentId, user.id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.code }, { status: 401 });
    }
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }
}
