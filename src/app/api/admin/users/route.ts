import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { db, mutate } from "@/lib/db";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-origin";
import { BotChat, BotPlatform, User } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type AdminUserView = {
  id: string;
  name: string;
  email: string | null;
  /** Preferred display handle, e.g. "@vektor_komforta38". */
  nickname: string | null;
  handles: { telegram: string | null; vk: string | null; max: string | null };
  platforms: BotPlatform[];
  credits: number;
  isAdmin: boolean;
  origin: string | null;
  isBot: boolean;
  createdAt: number;
  /** Last time the user talked to one of the bots (falls back to createdAt). */
  lastActiveAt: number | null;
  generations: number;
};

function failure(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 403 });
  return NextResponse.json(
    { error: e instanceof RequestError ? e.code : "users_failed", message: safeErrorMessage(e) },
    { status: e instanceof RequestError ? e.status : 500 }
  );
}

function userPlatforms(u: User): BotPlatform[] {
  const out: BotPlatform[] = [];
  if (u.telegramId !== null && u.telegramId !== undefined) out.push("telegram");
  if (u.vkId !== null && u.vkId !== undefined) out.push("vk");
  if (u.maxId !== null && u.maxId !== undefined) out.push("max");
  return out;
}

function userView(u: User, chats: BotChat[], gensByUser: Map<string, number>): AdminUserView {
  const handles = { telegram: u.telegramUsername ?? null, vk: u.vkUsername ?? null, max: u.maxUsername ?? null };
  const platforms = userPlatforms(u);
  const myChats = chats.filter((c) => c.userId === u.id);
  const lastActiveAt = myChats.length ? Math.max(...myChats.map((c) => c.updatedAt)) : u.createdAt;
  const nickname = handles.telegram
    ? `@${handles.telegram}`
    : handles.vk
    ? `@${handles.vk}`
    : handles.max
    ? `@${handles.max}`
    : null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    nickname,
    handles,
    platforms,
    credits: u.credits,
    isAdmin: !!u.isAdmin,
    origin: u.origin ?? null,
    isBot: platforms.length > 0 || (!!u.origin && u.origin !== "web"),
    createdAt: u.createdAt,
    lastActiveAt,
    generations: gensByUser.get(u.id) || 0,
  };
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/^@/, "").toLowerCase();
}

function matchesUser(u: User, q: string): boolean {
  const haystack = [u.name, u.email, u.telegramUsername, u.vkUsername, u.maxUsername, u.id, u.referralCode]
    .filter((v): v is string => !!v)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const d = await db();
    const q = normalizeQuery(req.nextUrl.searchParams.get("q") || "");
    const botOnly = req.nextUrl.searchParams.get("bot") === "1";
    const gensByUser = new Map<string, number>();
    for (const g of d.generations) gensByUser.set(g.userId, (gensByUser.get(g.userId) || 0) + 1);

    let users = [...d.users];
    if (botOnly) users = users.filter((u) => userPlatforms(u).length > 0 || (!!u.origin && u.origin !== "web"));
    if (q) users = users.filter((u) => matchesUser(u, q));
    users.sort((a, b) => {
      const act = (u: User) => {
        const c = d.botChats.filter((x) => x.userId === u.id);
        return c.length ? Math.max(...c.map((x) => x.updatedAt)) : u.createdAt;
      };
      return act(b) - act(a);
    });

    return NextResponse.json(
      {
        users: users.slice(0, 500).map((u) => userView(u, d.botChats, gensByUser)),
        total: Math.min(users.length, 500),
        filter: { q: q || null, botOnly },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await requireAdmin(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      return NextResponse.json({ ok: false, error: "bad_amount" }, { status: 400 });
    }

    const d = await db();
    const gensByUser = new Map<string, number>();
    for (const g of d.generations) gensByUser.set(g.userId, (gensByUser.get(g.userId) || 0) + 1);

    let target: User | null = null;
    if (typeof body.userId === "string" && body.userId.trim()) {
      target = d.users.find((u) => u.id === body.userId) || null;
      if (!target) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    } else {
      const q = normalizeQuery(String(body.query ?? ""));
      if (!q) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
      const found = d.users.filter((u) => matchesUser(u, q));
      if (found.length === 0) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      if (found.length > 1) {
        return NextResponse.json(
          { ok: false, error: "multiple", users: found.slice(0, 10).map((u) => userView(u, d.botChats, gensByUser)) },
          { status: 409 }
        );
      }
      target = found[0];
    }

    const userId = target.id;
    const result = await mutate((draft) => {
      const u = draft.users.find((x) => x.id === userId);
      if (!u) throw new RequestError("not_found", "Пользователь не найден", 404);
      u.credits += amount;
      const chats = draft.botChats.filter((c) => c.userId === userId);
      const genCount = draft.generations.filter((g) => g.userId === userId).length;
      return { credits: u.credits, view: userView(u, chats, new Map([[userId, genCount]])) };
    });

    return NextResponse.json(
      { ok: true, granted: amount, credits: result.credits, user: result.view },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return failure(e);
  }
}
