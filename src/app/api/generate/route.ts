import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { authorizeGeneration } from "@/lib/billing";
import { activeStyles, getSettingNumber } from "@/lib/config";
import { saveUpload } from "@/app/api/upload/service";
import { runStyleGeneration } from "@/lib/generation/pipeline";
import { Style } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A real image-edit call can take minutes; never kill it mid-flight.
export const maxDuration = 300;

const schema = z.object({
  styleId: z.string().optional(),
  scope: z.enum(["single", "all"]).default("single"),
  /** Optional free-text wish: applied on top of the style. */
  instruction: z.string().max(600).optional(),
});

/**
 * Starts one or more designs from an uploaded photo.
 *
 * Same pipeline the messenger bots use, so a design created in Telegram and one
 * created here are indistinguishable: same record, same credits, same shopping
 * list with marketplace links.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }

  const form = await req.formData().catch(() => null);
  if (!form || !(form.get("file") instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  const file = form.get("file") as File;
  const parsed = schema.safeParse({
    styleId: (form.get("styleId") as string) || undefined,
    scope: (form.get("scope") as string) || "single",
    instruction: (form.get("instruction") as string) || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "not_image" }, { status: 400 });

  const maxMb = await getSettingNumber("max_original_mb", 20);
  if (file.size > maxMb * 1024 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const savedUpload = await saveUpload(buffer, file.type);
  const originalId = savedUpload.id;
  const originalUrl = savedUpload.url;

  const styles: Style[] = await activeStyles();
  let targetStyles: Style[] = [];
  const scope = parsed.data.scope;

  if (scope === "single") {
    const st = styles.find((s) => s.id === parsed.data.styleId);
    if (!st) return NextResponse.json({ error: "style_not_found" }, { status: 400 });
    targetStyles = [st];
  } else {
    targetStyles = styles;
  }

  const charge = await authorizeGeneration(user, scope);
  if (!charge.ok) {
    return NextResponse.json({ error: charge.error }, { status: charge.error === "no_trial" ? 403 : 402 });
  }

  const generations = [];
  for (const style of targetStyles) {
    try {
      const payload = await runStyleGeneration({
        user,
        style,
        source: { buffer, mime: file.type },
        originalId,
        originalUrl,
        consumed: charge.consumed,
        instruction: parsed.data.instruction || null,
        origin: "web",
      });
      generations.push(payload);
    } catch (e) {
      generations.push({
        id: "",
        styleId: style.id,
        styleSlug: style.slug,
        styleName: { ru: style.name.ru, en: style.name.en },
        originalUrl,
        resultUrl: originalUrl,
        status: "failed",
        provider: "—",
        mode: charge.consumed,
        demoConfig: null,
        note: null,
        error: e instanceof Error ? e.message : "unknown",
        kind: "design",
        instruction: parsed.data.instruction || null,
        parentGenerationId: null,
        changedCategories: [],
        shopping: { items: [], mode: "list", detector: "off", note: null, updatedAt: Date.now() },
        published: false,
        createdAt: Date.now(),
      });
    }
  }

  const { isUnlimitedMode } = await import("@/lib/config");
  return NextResponse.json({
    ok: true,
    scope,
    consumed: charge.consumed,
    unlimited: await isUnlimitedMode(),
    isDemo: generations.every((g) => g.status === "done" && g.resultUrl === g.originalUrl),
    generations,
  });
}
