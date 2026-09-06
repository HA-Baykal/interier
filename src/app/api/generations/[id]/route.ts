import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeStyles } from "@/lib/config";
import { shoppingSettings } from "@/lib/shopping";
import { relinkItems } from "@/lib/marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full design record for the studio / mini app, including the shopping list. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const d = await db();
  const gen = d.generations.find((g) => g.id === params.id);
  if (!gen) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gen.userId !== user.id && !user.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const styles = await activeStyles();
  const style = styles.find((s) => s.id === gen.styleId);
  const settings = await shoppingSettings();

  // Links are rebuilt on read so a marketplace change in the admin panel is
  // reflected immediately without touching stored data.
  const shopping = gen.shopping
    ? { ...gen.shopping, items: relinkItems(gen.shopping.items, { enabled: settings.marketplaces, extraParams: settings.extraParams }) }
    : null;

  const parent = gen.parentGenerationId ? d.generations.find((g) => g.id === gen.parentGenerationId) || null : null;

  return NextResponse.json({
    generation: {
      id: gen.id,
      styleId: gen.styleId,
      styleSlug: style?.slug ?? "unknown",
      styleName: style ? style.name : { ru: "Стиль", en: "Style" },
      originalUrl: gen.originalUrl ?? `/api/uploads/${gen.originalId}`,
      resultUrl: gen.resultUrl,
      status: gen.status,
      provider: gen.provider,
      mode: gen.mode,
      published: !!gen.published,
      createdAt: gen.createdAt,
      kind: gen.kind || "design",
      instruction: gen.instruction ?? null,
      changedCategories: gen.changedCategories ?? [],
      parent: parent
        ? {
            id: parent.id,
            resultUrl: parent.resultUrl,
            originalUrl: parent.originalUrl ?? `/api/uploads/${parent.originalId}`,
            createdAt: parent.createdAt,
          }
        : null,
      shopping,
    },
  });
}
