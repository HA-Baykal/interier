import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db, mutate, uid } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  slug: z.string().min(1).max(60),
  nameRu: z.string().min(1).max(100),
  nameEn: z.string().min(1).max(100),
  descRu: z.string().max(500).optional().default(""),
  descEn: z.string().max(500).optional().default(""),
  credits: z.number().int().min(1),
  price: z.number().min(0),
  badgeRu: z.string().max(60).optional().nullable(),
  badgeEn: z.string().max(60).optional().nullable(),
  active: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const d = await db();
  return NextResponse.json({ packages: d.packages || [] });
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request", details: parsed.error.issues }, { status: 400 });

  const id = uid("pack");
  const pkg = {
    id,
    slug: parsed.data.slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, ""),
    name: { ru: parsed.data.nameRu.trim(), en: parsed.data.nameEn.trim() },
    description: { ru: (parsed.data.descRu || "").trim(), en: (parsed.data.descEn || "").trim() },
    credits: Math.max(1, Math.floor(parsed.data.credits)),
    price: Math.max(0, Math.floor(parsed.data.price)),
    badge: parsed.data.badgeRu || parsed.data.badgeEn ? {
      ru: (parsed.data.badgeRu || "").trim(),
      en: (parsed.data.badgeEn || "").trim(),
    } : null,
    active: parsed.data.active !== false,
  };

  await mutate((d) => {
    d.packages.push(pkg);
  });

  return NextResponse.json({ ok: true, package: pkg });
}
