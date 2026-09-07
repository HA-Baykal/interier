import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { vkApi, vkMe } from "@/lib/bots/vk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Small VK helpers for the admin "Боты" panel so the owner does not have to
 * hunt for ids in the VK interface:
 *   ?action=groups — communities the pasted token can manage (to auto-fill vk_group_id)
 *   ?action=me     — the community bound to the token (name + id)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
  const action = req.nextUrl.searchParams.get("action") || "me";

  if (action === "me") {
    const me = await vkMe();
    return NextResponse.json({ ok: true, me });
  }

  try {
    const list = await vkApi<{ response: { items?: number[]; count?: number } | number[] }>("groups.get", {});
    const resp: any = list.response;
    let ids: number[] = Array.isArray(resp) ? resp : Array.isArray(resp?.items) ? resp.items : [];
    if (!ids.length) return NextResponse.json({ ok: true, groups: [] });
    const info = await vkApi<{ response: { id: number; name: string; screen_name: string }[] }>("groups.getById", {
      group_ids: ids.join(","),
    });
    const groups = (info.response || []).map((g) => ({ id: String(g.id), name: g.name, screen: g.screen_name }));
    return NextResponse.json({ ok: true, groups });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
