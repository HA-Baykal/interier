import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { grantTelegramBonus } from "@/lib/billing";

const schema = z.object({
  channel: z.enum(["telegram", "vk"]),
  externalId: z.string().optional(),
  username: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Demo mode: no platform token, so verification is simulated.
  // When a real token is configured this would call Telegram/VK API.
  const result = await grantTelegramBonus(
    user,
    parsed.data.channel,
    parsed.data.externalId ? Number(parsed.data.externalId) : null,
    parsed.data.username ?? null
  );

  return NextResponse.json({
    ok: result.granted,
    already: result.already,
    credits: result.credits,
  });
}
