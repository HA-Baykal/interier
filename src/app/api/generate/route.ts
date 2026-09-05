import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mutate, uid, now } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { activeStyles, isUnlimitedMode } from "@/lib/config";
import { saveUpload, imageMime, maxOriginalBytes } from "@/app/api/upload/service";
import { planGeneration, executeRealGeneration } from "@/lib/generation/provider";
import { getGenerationSettings, validateCompatibleConfig } from "@/lib/generation/settings";
import { RequestError, safeErrorMessage } from "@/lib/errors";
import type { Generation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  styleId: z.string().optional(),
  scope: z.enum(["single", "all"]).default("single"),
});

export async function POST(req: NextRequest) {
  let apiKey = "";
  try {
    const user = await requireUser(req);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new RequestError("file_required", "Выберите фото комнаты.");
    const parsed = schema.safeParse({ styleId: form?.get("styleId") || undefined, scope: form?.get("scope") || "single" });
    if (!parsed.success) throw new RequestError("bad_request", "Некорректный стиль или режим генерации.");
    if (!file.size || file.size > maxOriginalBytes()) throw new RequestError("file_too_large", "Фото должно быть не больше 20 МБ.", 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = imageMime(buffer);
    if (!mime) throw new RequestError("not_image", "Поддерживаются только фото JPEG, PNG и WebP.");

    const { scope, styleId } = parsed.data;
    const styles = await activeStyles();
    const targetStyles = scope === "all" ? styles : styles.filter((s) => s.id === styleId);
    if (!targetStyles.length) throw new RequestError("style_not_found", "Выбранный стиль не найден.");
    const settings = await getGenerationSettings();
    apiKey = settings.compatible.apiKey;
    const isDemo = settings.mode === "demo";
    if (!isDemo && !settings.aiConfigured) throw new RequestError("ai_not_configured", "Ключ ИИ не настроен. Администратору нужно сохранить API-ключ в настройках.", 503);
    if (settings.mode === "compatible") validateCompatibleConfig(settings.compatible);
    const unlimited = await isUnlimitedMode();
    const plans = await Promise.all(targetStyles.map(async (st) => ({ st, id: uid("gen"), plan: await planGeneration(st, settings) })));
    const upload = await saveUpload(buffer, mime);

    // Check the current balance/trial and create records together, not using a stale user snapshot.
    const { generations, consumed } = await mutate((d) => {
      const current = d.users.find((u) => u.id === user.id);
      if (!current) throw new AuthError("NOT_AUTHENTICATED");
      let consumed: Generation["mode"] = "unlimited";
      if (!unlimited) {
        if (!current.trialUsed) { current.trialUsed = true; consumed = "trial"; }
        else if (scope === "all") throw new RequestError("no_trial", "Бесплатная генерация уже использована.", 403);
        else if (current.credits > 0) { current.credits--; consumed = "credit"; }
        else throw new RequestError("no_credits", "Недостаточно генераций на балансе.", 402);
      }
      const generations: Generation[] = plans.map(({ st, id, plan }) => ({
        id, userId: user.id, styleId: st.id, originalId: upload.id, originalUrl: upload.url,
        resultUrl: isDemo ? upload.url : null, status: isDemo ? "done" : "processing",
        error: null, mode: consumed, provider: plan.provider, createdAt: now(), published: false,
      }));
      d.generations.push(...generations);
      return { generations, consumed };
    });

    // All styles share one bounded window, rather than N sequential 180s polls.
    const payload = await Promise.all(generations.map(async (g, index) => {
      const { st, plan } = plans[index];
      let resultUrl = isDemo ? upload.url : null;
      let status: Generation["status"] = "done";
      let provider = plan.provider;
      let error: string | null = null;
      let note = plan.note;
      if (!isDemo) {
        try {
          const result = await executeRealGeneration(plan, buffer, mime);
          if (!result) throw new Error("AI provider returned no image");
          resultUrl = result.resultUrl;
          provider = result.provider;
          note = "Готово.";
        } catch (e) {
          status = "failed";
          error = safeErrorMessage(e, [apiKey]);
          note = error;
        }
      }
      return {
        id: g.id, styleId: st.id, styleSlug: st.slug, originalUrl: upload.url,
        resultUrl, status, provider, mode: consumed, demoConfig: plan.demoConfig,
        note, error, consumed, published: false,
      };
    }));

    await mutate((d) => {
      for (const item of payload) {
        const record = d.generations.find((g) => g.id === item.id);
        if (record) Object.assign(record, { status: item.status, resultUrl: item.resultUrl, provider: item.provider, error: item.error });
      }
      // A failed request must not burn the user's free trial / internal credit.
      if (payload.every((p) => p.status === "failed")) {
        const current = d.users.find((u) => u.id === user.id);
        if (current && consumed === "trial") current.trialUsed = false;
        if (current && consumed === "credit") current.credits++;
      }
    });
    return NextResponse.json({ ok: true, scope, consumed, isDemo, unlimited, generations: payload });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: 401 });
    const message = safeErrorMessage(e, [apiKey]);
    return NextResponse.json({ error: e instanceof RequestError ? e.code : "generation_failed", message }, { status: e instanceof RequestError ? e.status : 500 });
  }
}
