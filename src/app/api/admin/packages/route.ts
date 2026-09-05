import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { mutate, uid } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  slug: z.string().min(2).max(60),
  nameRu: z.string().min(1),
  nameEn: z.string().min(1),
  credits: z.number().int().positive(),
  price: z.number().positive(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  await mutate((d) => {
    d.packages.push({
      id: uid("pack"),
      slug: parsed.data.slug,
      name: { ru: parsed.data.nameRu, en: parsed.data.nameEn },
      description: { ru: "", en: "" },
      credits: parsed.data.credits,
      price: parsed.data.price,
      badge: null,
      active: true,
    });
  });

  return NextResponse.json({ ok: true });
}
