import { NextResponse } from "next/server";
import { ensureBootSafe } from "@/lib/boot";
import { MARKETPLACES } from "@/lib/marketplaces";
import { shoppingSettings } from "@/lib/shopping";

export const runtime = "nodejs";
// Settings live in the DB and the admin can change the store list at any time.
export const dynamic = "force-dynamic";

/** Enabled marketplaces + the whole catalog, for the UI and the admin panel. */
export async function GET() {
  await ensureBootSafe();
  const settings = await shoppingSettings();
  const { CATEGORIES } = await import("@/lib/marketplaces");
  return NextResponse.json({
    enabled: settings.marketplaces.map((m) => ({ id: m.id, label: m.label, short: m.short, emoji: m.emoji })),
    all: MARKETPLACES.map((m) => ({ id: m.id, label: m.label, short: m.short, emoji: m.emoji, strengths: m.strengths })),
    defaultMode: settings.defaultMode,
    categories: CATEGORIES.map((c) => ({ id: c.id, ru: c.ru, en: c.en, emoji: c.emoji })),
  });
}
