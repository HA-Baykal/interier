import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { vkApi, vkMe } from "@/lib/bots/vk";
import { vkConfig } from "@/lib/bots/config";

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

  if (action === "diagnose") {
    const cfg = await vkConfig();
    if (!cfg.token || !cfg.groupId) {
      return NextResponse.json({ ok: false, error: "нет vk_access_token / vk_group_id" }, { status: 400 });
    }
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const ourUrl = `https://${host}/api/bots/vk/webhook`;
    try {
      const list = await vkApi<{ response: { items: { server_id: number; url: string; state?: string }[] } }>(
        "groups.getCallbackServers",
        { group_id: cfg.groupId }
      );
      const servers = list.response?.items || [];
      const ours = servers.find((s) => s.url.includes("/api/bots/vk/webhook"));
      let settings: Record<string, unknown> | null = null;
      if (ours) {
        const st = await vkApi<{ response: Record<string, unknown> }>("groups.getCallbackSettings", {
          group_id: cfg.groupId,
          server_id: ours.server_id,
        });
        settings = st.response || null;
      }
      return NextResponse.json({ ok: true, ourUrl, servers, ours: ours ?? null, settings });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), ourUrl }, { status: 400 });
    }
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
