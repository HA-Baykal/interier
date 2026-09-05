import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db, mutate, uid } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  slug: z.string().min(2).max(60),
  nameRu: z.string().min(1),
  nameEn: z.string().min(1),
  descRu: z.string().min(1),
  descEn: z.string().min(1),
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

  const d = await db();
  if (d.styles.some((s) => s.slug === parsed.data.slug)) {
    return NextResponse.json({ error: "slug_exists" }, { status: 409 });
  }

  await mutate((draft) => {
    draft.styles.push({
      id: uid("style"),
      slug: parsed.data.slug,
      name: { ru: parsed.data.nameRu, en: parsed.data.nameEn },
      description: { ru: parsed.data.descRu, en: parsed.data.descEn },
      preview: "/styles/default.jpg",
      config: {
        filter: "brightness(1.05) contrast(1.05) saturate(1.1)",
        tint: "rgba(255,255,255,0.08)",
        vignette: 0.2,
        accent: "#888",
      },
      active: true,
    });
  });

  return NextResponse.json({ ok: true });
}
