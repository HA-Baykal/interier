import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getAdminUsersList, adjustUserCredits } from "@/lib/admin-users";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "private, no-store" };

function failure(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
  return NextResponse.json(
    { ok: false, error: e instanceof RequestError ? e.code : "users_failed", message: safeErrorMessage(e) },
    { status: e instanceof RequestError ? e.status : 500 }
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const data = await getAdminUsersList();
    return NextResponse.json({ ok: true, ...data }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}

const updateSchema = z.object({
  userId: z.string().min(1),
  delta: z.number().int().optional(),
  setCredits: z.number().int().min(0).optional(),
  resetTrial: z.boolean().optional(),
  setTrialUsed: z.boolean().optional(),
  setIsAdmin: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireAdmin(req);

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid_params", details: parsed.error.format() }, { status: 400 });
    }

    const { userId, delta, setCredits, resetTrial, setTrialUsed, setIsAdmin } = parsed.data;
    const user = await adjustUserCredits(userId, { delta, setCredits, resetTrial, setTrialUsed, setIsAdmin });

    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, user }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}
