import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db, mutate } from "@/lib/db";
import { normalizePrice, packagePatchSchema } from "@/lib/packages-admin";

/**
 * Edit or remove one package. Every field is optional, so the admin panel can
 * save a single changed input — usually just the price.
 */

async function guard(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard(req);
  if (denied) return denied;
  const parsed = packagePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", field: parsed.error.issues[0]?.path.join(".") }, { status: 400 });
  }
  const data = parsed.data;
  if (!(await db()).packages.some((p) => p.id === params.id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await mutate((d) => {
    const p = d.packages.find((x) => x.id === params.id);
    if (!p) return;
    if (data.nameRu !== undefined) p.name.ru = data.nameRu;
    if (data.nameEn !== undefined) p.name.en = data.nameEn;
    if (data.descRu !== undefined) p.description.ru = data.descRu;
    if (data.descEn !== undefined) p.description.en = data.descEn;
    if (data.credits !== undefined) p.credits = data.credits;
    if (data.price !== undefined) p.price = normalizePrice(data.price);
    if (data.active !== undefined) p.active = data.active;
    if (data.badgeRu !== undefined || data.badgeEn !== undefined) {
      const ru = (data.badgeRu ?? p.badge?.ru ?? "").trim();
      const en = (data.badgeEn ?? p.badge?.en ?? "").trim();
      p.badge = ru || en ? { ru, en } : null;
    }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!(await db()).packages.some((p) => p.id === params.id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await mutate((d) => {
    d.packages = d.packages.filter((p) => p.id !== params.id);
  });
  return NextResponse.json({ ok: true });
}
