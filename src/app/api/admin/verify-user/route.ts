import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { mutate, now } from "@/lib/db";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Manually mark a buyer's e-mail as confirmed. Useful to hand a payment-provider
 * moderator (or any buyer who can't receive the code) a ready-to-use account:
 * after this they log in with e-mail + password and skip the code step.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireAdmin(req);
    const body = await req.json().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "no_email" }, { status: 400 });

    const found = await mutate<boolean>((d) => {
      const u = d.users.find((x) => x.email?.trim().toLowerCase() === email);
      if (!u) return false;
      u.identityVerifiedAt = now();
      u.identityVerifiedBy = "email";
      u.emailConfirmCode = null;
      u.emailConfirmExpires = null;
      return true;
    });
    if (!found) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof RequestError ? e.code : "verify_failed", message: safeErrorMessage(e) }, { status: e instanceof RequestError ? e.status : 500 });
  }
}
