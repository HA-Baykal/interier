import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activeStyles } from "@/lib/config";
import { GalleryItem } from "@/lib/types";

/**
 * Public gallery of owner-opted-in designs. No auth required.
 * Only generations with status "done" that the owner chose to publish are shown;
 * the owner's identity is never exposed.
 */
export async function GET() {
  const styles = await activeStyles();
  const items: GalleryItem[] = (await db())
    .generations.filter((g) => g.published && g.status === "done" && g.resultUrl)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 120)
    .map((g) => {
      const st = styles.find((s) => s.id === g.styleId);
      return {
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
