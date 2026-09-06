import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { addManualItem, regenerateShopping, removeItem } from "@/lib/generation/pipeline";
import { db } from "@/lib/db";
import { shoppingSettings } from "@/lib/shopping";
import { relinkItems } from "@/lib/marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const manualSchema = z.object({
  label: z.string().min(1).max(60),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/**
 * Shopping-list details of a design.
 *
 * GET    — current items (links rebuilt from the live marketplace config)
 * POST   { action } — "refresh" (re-run the detector) | "add" (manual pin)
 * DELETE ?item=<id> — remove one detail
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  const gen = (await db()).generations.find((g) => g.id === params.id);
  if (!gen) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gen.userId !== user.id && !user.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const settings = await shoppingSettings();
  return NextResponse.json({
    shopping: gen.shopping
      ? { ...gen.shopping, items: relinkItems(gen.shopping.items, { enabled: settings.marketplaces, extraParams: settings.extraParams }) }
      : null,
    mode: settings.defaultMode,
    marketplaces: settings.marketplaces.map((m) => ({ id: m.id, label: m.label, emoji: m.emoji })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "refresh";

  if (action === "add") {
    const parsed = manualSchema.safeParse({ label: body?.label, x: body?.x, y: body?.y });
    if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const res = await addManualItem({ user, generationId: params.id, ...parsed.data });
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.error === "forbidden" ? 403 : 400 });
    return NextResponse.json({ ok: true, item: res.item });
  }

  const ok = await regenerateShopping(params.id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const gen = (await db()).generations.find((g) => g.id === params.id);
  return NextResponse.json({ ok: true, shopping: gen?.shopping ?? null });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
  const itemId = req.nextUrl.searchParams.get("item");
  if (!itemId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const res = await removeItem({ user, generationId: params.id, itemId });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.error === "forbidden" ? 403 : 404 });
  return NextResponse.json({ ok: true });
}
