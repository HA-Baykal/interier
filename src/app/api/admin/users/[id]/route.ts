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
    { ok: false, error: e instanceof RequestError ? e.code : "user_failed", message: safeErrorMessage(e) },
    { status: e instanceof RequestError ? e.status : 500 }
  );
}

const patchSchema = z.object({
  delta: z.number().int().optional(),
  setCredits: z.number().int().min(0).optional(),
  resetTrial: z.boolean().optional(),
  setTrialUsed: z.boolean().optional(),
  setIsAdmin: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const { users } = await getAdminUsersList();
    const user = users.find((u) => u.id === params.id);
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, user }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(req);
    await requireAdmin(req);

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid_params", details: parsed.error.format() }, { status: 400 });
    }

    const user = await adjustUserCredits(params.id, parsed.data);
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, user }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  return PATCH(req, context);
}
