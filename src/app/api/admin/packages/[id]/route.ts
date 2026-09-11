import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db, mutate } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  slug: z.string().min(1).max(60).optional(),
  nameRu: z.string().min(1).max(100).optional(),
  nameEn: z.string().min(1).max(100).optional(),
  descRu: z.string().max(500).optional(),
  descEn: z.string().max(500).optional(),
  credits: z.number().int().min(1).optional(),
  price: z.number().min(0).optional(),
  badgeRu: z.string().max(60).optional().nullable(),
  badgeEn: z.string().max(60).optional().nullable(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request", details: parsed.error.issues }, { status: 400 });

  const outcome = await mutate((d) => {
    const pkg = d.packages.find((p) => p.id === params.id);
    if (!pkg) return null;

    if (parsed.data.slug !== undefined) pkg.slug = parsed.data.slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "");
    if (parsed.data.nameRu !== undefined) pkg.name.ru = parsed.data.nameRu.trim();
    if (parsed.data.nameEn !== undefined) pkg.name.en = parsed.data.nameEn.trim();
    if (parsed.data.descRu !== undefined) pkg.description.ru = parsed.data.descRu.trim();
    if (parsed.data.descEn !== undefined) pkg.description.en = parsed.data.descEn.trim();
    if (parsed.data.credits !== undefined) pkg.credits = Math.max(1, Math.floor(parsed.data.credits));
    if (parsed.data.price !== undefined) pkg.price = Math.max(0, Math.floor(parsed.data.price));
    if (parsed.data.active !== undefined) pkg.active = parsed.data.active;

    if (parsed.data.badgeRu !== undefined || parsed.data.badgeEn !== undefined) {
      const ru = parsed.data.badgeRu !== undefined ? parsed.data.badgeRu : pkg.badge?.ru || "";
      const en = parsed.data.badgeEn !== undefined ? parsed.data.badgeEn : pkg.badge?.en || "";
      if (ru || en) {
        pkg.badge = { ru: (ru || "").trim(), en: (en || "").trim() };
      } else {
        pkg.badge = null;
      }
    }

    return pkg;
  });

  if (!outcome) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, package: outcome });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  await mutate((d) => {
    d.packages = d.packages.filter((p) => p.id !== params.id);
  });
  return NextResponse.json({ ok: true });
}
