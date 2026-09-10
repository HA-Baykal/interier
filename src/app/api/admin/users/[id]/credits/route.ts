import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { adjustUserCredits } from "@/lib/admin-users";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "private, no-store" };

function failure(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
  return NextResponse.json(
    { ok: false, error: e instanceof RequestError ? e.code : "credits_failed", message: safeErrorMessage(e) },
    { status: e instanceof RequestError ? e.status : 500 }
  );
}

const creditSchema = z.object({
  amount: z.number().int(),
  mode: z.enum(["add", "set"]).optional(),
  resetTrial: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(req);
    await requireAdmin(req);

    const body = await req.json().catch(() => null);
    const parsed = creditSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid_params", details: parsed.error.format() }, { status: 400 });
    }

    const { amount, mode, resetTrial } = parsed.data;
    const patch = mode === "set" ? { setCredits: amount, resetTrial } : { delta: amount, resetTrial };
    const user = await adjustUserCredits(params.id, patch);

    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, user }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}
