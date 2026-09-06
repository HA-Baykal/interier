import { NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { db } from "@/lib/db";
import { activeStyles } from "@/lib/config";
import { shoppingSettings } from "@/lib/shopping";
import { GalleryItem, ShoppingList } from "@/lib/types";

export const runtime = "nodejs";
// This route reads the mutable DB: never prerender it, or a production build
// would freeze the gallery (and every new published design would stay invisible).
export const dynamic = "force-dynamic";

/**
 * Public gallery of owner-opted-in designs. No auth required.
 * Only generations with status "done" that the owner chose to publish are shown;
 * the owner's identity is never exposed.
 */
export async function GET() {
  await ensureBootSafe();
  const [styles, settings] = await Promise.all([activeStyles(), shoppingSettings()]);
  const items: GalleryItem[] = (await db())
    .generations.filter((g) => g.published && g.status === "done" && g.resultUrl)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 120)
    .map((g) => {
      const st = styles.find((s) => s.id === g.styleId);
      // Only the owner's opt-in exposes the shopping list, and only the fields a
      // visitor needs: what the detail is and where to buy it.
      const shopping = settings.publicLinks
        ? toPublicShopping(g.shopping, settings.maxItems)
        : null;
      return {
        shopping,
        id: g.id,
        styleSlug: st?.slug ?? "unknown",
        styleName: st ? st.name : { ru: "Стиль", en: "Style" },
        originalUrl: g.originalUrl ?? `/api/uploads/${g.originalId}`,
        resultUrl: g.resultUrl!,
        provider: g.provider,
        createdAt: g.createdAt,
      };
    });

  return NextResponse.json({ items });
}

/** Strip the internal bookkeeping before a shopping list becomes public. */
function toPublicShopping(list: ShoppingList | null | undefined, maxItems: number): GalleryItem["shopping"] {
  const items = (list?.items || []).filter((i) => (i.links || []).length > 0).slice(0, maxItems);
  if (!items.length) return null;
  const boxed = items.filter((i) => Array.isArray(i.bbox) && i.bbox.length === 4).length;
  return {
    mode: boxed === items.length && boxed >= 2 ? "hotspots" : "list",
    items: items.map((i) => ({
      name: i.name,
      nameEn: i.nameEn,
      query: i.query,
      queryEn: i.queryEn,
      bbox: i.bbox,
      links: i.links.map((l) => ({ label: l.label, url: l.url })),
    })),
  };
}
