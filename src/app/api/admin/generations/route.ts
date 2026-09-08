import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { shoppingSettings } from "@/lib/shopping";
import { reasonFor } from "@/lib/generations-admin";

/**
 * Admin list of generations with a human-readable reason when a design has no
 * shopping details. The owner opens this to answer «почему у генерации нет
 * списка деталей?» without reading code.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }

  const d = await db();
  const settings = await shoppingSettings();
  const emailOf = new Map(d.users.map((u) => [u.id, u.email ?? u.referralCode]));

  const rows = [...d.generations]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100)
    .map((g) => ({
      id: g.id,
      createdAt: g.createdAt,
      styleId: g.styleId,
      kind: g.kind ?? "design",
      status: g.status,
      origin: g.origin ?? "web",
      owner: emailOf.get(g.userId) ?? g.userId,
      detector: g.shopping?.detector ?? null,
      mode: g.shopping?.mode ?? null,
      items: g.shopping?.items.length ?? 0,
      hotspots: g.shopping?.items.filter((i) => i.bbox).length ?? 0,
      note: g.shopping?.note ?? null,
      reason: reasonFor(g, settings.enabled, settings.auto),
    }));

  return NextResponse.json({
    generations: rows,
    settings: {
      enabled: settings.enabled,
      auto: settings.auto,
      defaultMode: settings.defaultMode,
      marketplaces: settings.marketplaces.map((m) => m.id),
    },
  });
}
