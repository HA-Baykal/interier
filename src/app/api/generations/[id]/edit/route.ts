import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { runInstructionEdit } from "@/lib/generation/pipeline";
import { parseInstruction } from "@/lib/generation/instruction";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { privateHeaders } from "@/lib/auth-response";
import { categoryById } from "@/lib/marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  instruction: z.string().min(2).max(600),
  styleId: z.string().optional(),
});

/**
 * Targeted edit from the user's own words: "замени только шторы".
 *
 * The previous design is the input, the instruction decides what may change, and
 * the returned record carries a shopping list narrowed to the changed details.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  // Guards from the shared pipeline (balance, verification, provider config)
  // arrive as errors with a code and a status: report them, never a 500.
  const failure = (e: unknown) => NextResponse.json(
    { error: e instanceof RequestError ? e.code : "edit_failed", message: safeErrorMessage(e) },
    { status: e instanceof RequestError ? e.status : 500, headers: { ...privateHeaders } }
  );

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const instruction = parsed.data.instruction.trim();
  const ip = parseInstruction(instruction);
  if (!ip || !ip.targetCategories.length) {
    return NextResponse.json({ error: "nothing_detected", instruction }, { status: 422 });
  }

  let res: Awaited<ReturnType<typeof runInstructionEdit>>;
  try {
    res = await runInstructionEdit({
      user,
      generationId: params.id,
      instruction,
      styleOverrideId: parsed.data.styleId || null,
      origin: "web",
    });
  } catch (e) {
    return failure(e);
  }
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.error === "forbidden" ? 403 : 400 });

  return NextResponse.json({
    ok: true,
    generation: res.payload,
    targets: (res.payload.changedCategories || []).map((id) => ({
      id,
      ru: categoryById(id)?.ru || id,
      en: categoryById(id)?.en || id,
    })),
  });
}
