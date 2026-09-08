import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { createStarsInvoiceLink, starsConfigured } from "@/lib/payments-stars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a Telegram Stars invoice for a package and return its link. The Mini
 * App opens it with `Telegram.WebApp.openInvoice(url)`; credits are granted by
 * the `successful_payment` webhook (see lib/payments-stars).
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  if (!(await starsConfigured())) return NextResponse.json({ error: "stars_not_configured" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const packageId = String(body?.packageId || "");
  try {
    const { url, stars } = await createStarsInvoiceLink(user.id, packageId);
    return NextResponse.json({ ok: true, url, stars });
  } catch (e) {
    return NextResponse.json({ error: "stars_failed", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
