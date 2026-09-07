import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db, mutate, uid } from "@/lib/db";
import { normalizePrice, packageSchema, packageView, slugFromName } from "@/lib/packages-admin";

/**
 * Price list the owner edits by hand.
 *
 * Payments are not connected yet, so these numbers are a promise to the user,
 * not a charge — which is exactly why they must be editable without a redeploy
 * and without touching code: «5 генераций — 499 ₽» changes as often as the
 * economics of the aggregator does.
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

/** All packages, including the switched-off ones (the editor must see them). */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return NextResponse.json({ packages: (await db()).packages.map(packageView) });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const parsed = packageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", field: parsed.error.issues[0]?.path.join(".") }, { status: 400 });
  }
  const data = parsed.data;
  const slug = data.slug || slugFromName(data.nameRu) || `pack_${Date.now().toString(36)}`;
  if ((await db()).packages.some((p) => p.slug === slug)) {
    return NextResponse.json({ error: "slug_taken" }, { status: 409 });
  }

  const id = uid("pack");
  await mutate((d) => {
    d.packages.push({
      id,
      slug,
      name: { ru: data.nameRu, en: data.nameEn },
      description: { ru: data.descRu, en: data.descEn },
      credits: data.credits,
      price: normalizePrice(data.price),
      badge: data.badgeRu || data.badgeEn ? { ru: data.badgeRu || "", en: data.badgeEn || "" } : null,
      active: data.active ?? true,
    });
  });
  return NextResponse.json({ ok: true, id });
}
