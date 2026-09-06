import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeStyles } from "@/lib/config";
import { isImageQuality } from "@/lib/generation/quality";

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const styles = await activeStyles();
  const list = (await db())
    .generations.filter((g) => g.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 60)
    .map((g) => {
      const st = styles.find((s) => s.id === g.styleId);
      return {
        id: g.id,
        styleId: g.styleId,
        styleSlug: st?.slug ?? "unknown",
        styleName: st ? st.name : { ru: "Стиль", en: "Style" },
        originalUrl: g.originalUrl ?? `/api/uploads/${g.originalId}`,
        resultUrl: g.resultUrl,
        status: g.status,
        error: g.error,
        provider: g.provider,
        quality: isImageQuality(g.quality) ? g.quality : undefined,
        resolution: g.resolution,
        testProfile: g.testProfile,
        estimatedCostRub: g.estimatedCostRub,
        durationMs: g.durationMs,
        mode: g.mode,
        published: !!g.published,
        createdAt: g.createdAt,
      };
    });

  return NextResponse.json({ generations: list }, { headers: { "Cache-Control": "private, no-store" } });
}
