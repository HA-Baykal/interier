import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeStyles } from "@/lib/config";

export async function GET(req: NextRequest) {
  let user;
  try {
    user = requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const styles = activeStyles();
  const list = db()
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
        provider: g.provider,
        mode: g.mode,
        published: !!g.published,
        createdAt: g.createdAt,
      };
    });

  return NextResponse.json({ generations: list });
}
