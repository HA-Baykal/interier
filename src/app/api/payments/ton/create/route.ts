import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { createTonPayment, tonConfigured } from "@/lib/payments-ton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a pending TON payment and return the address/amount/memo to send. */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  if (!(await tonConfigured())) return NextResponse.json({ error: "ton_not_configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const packageId = String((body as any)?.packageId || "");
  try {
    const invoice = await createTonPayment(user.id, packageId);
    return NextResponse.json({ ok: true, ...invoice });
  } catch (e) {
    return NextResponse.json({ error: "ton_failed", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
