import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db, mutate } from "@/lib/db";

/**
 * Opt-in publishing of a generation to the public gallery.
 * POST { published: boolean } — only the owner (or an admin) may change it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let user;
  try {
    user = requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const gen = db().generations.find((g) => g.id === params.id);
  if (!gen) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gen.userId !== user.id && !user.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const published = body?.published === true;

  mutate((d) => {
    const rec = d.generations.find((g) => g.id === gen.id);
    if (rec) rec.published = published;
  });

  return NextResponse.json({ ok: true, published });
}
