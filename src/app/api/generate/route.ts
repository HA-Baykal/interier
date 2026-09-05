import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, mutate, uid, now } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { spendCredit } from "@/lib/billing";
import { activeStyles, generationMode, isUnlimitedMode } from "@/lib/config";
import { saveUpload } from "@/app/api/upload/service";
import { planGeneration, executeRealGeneration } from "@/lib/generation/provider";
import { Generation, Style } from "@/lib/types";

const schema = z.object({
  styleId: z.string().optional(),
  scope: z.enum(["single", "all"]).default("single"),
});

/**
 * Handles generation. For `scope: "all"` the free trial is used once and
 * every active style is generated. For `scope: "single"`, the selected
 * style is generated, consuming either the free trial (once) or a credit.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.code }, { status: 401 });
    }
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
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "not_image" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const originalId = saveUpload(buffer, file.type).id;
  const originalUrl = `/api/uploads/${originalId}`;

  const styles = activeStyles();
  let targetStyles: Style[] = [];
  let scope = parsed.data.scope;

  if (scope === "single") {
    const st = styles.find((s) => s.id === parsed.data.styleId);
    if (!st) return NextResponse.json({ error: "style_not_found" }, { status: 400 });
    targetStyles = [st];
  } else {
    targetStyles = styles;
  }

  // While testing we grant unlimited generations (no credits, no trial limit).
  const unlimited = isUnlimitedMode();

  // Determine how this generation is "paid for".
  let consumed: Generation["mode"] = unlimited ? "unlimited" : "trial";

  if (!unlimited) {
    if (scope === "single") {
      if (!user.trialUsed) {
        consumed = "trial";
        mutate((d) => {
          const u = d.users.find((x) => x.id === user.id);
          if (u) u.trialUsed = true;
        });
      } else {
        const ok = spendCredit(user.id);
        if (!ok) return NextResponse.json({ error: "no_credits" }, { status: 402 });
        consumed = "credit";
      }
    } else {
      // Trial "all" scope: mark trial used. All styles rendered free once.
      if (user.trialUsed) {
        return NextResponse.json({ error: "no_trial" }, { status: 403 });
      }
      consumed = "trial";
      mutate((d) => {
        const u = d.users.find((x) => x.id === user.id);
        if (u) u.trialUsed = true;
      });
    }
  }

  const mode = generationMode();
  const isDemo = mode === "demo";
  const generations: Generation[] = [];

  mutate((d) => {
    for (const st of targetStyles) {
      const plan = planGeneration(st);
      const g: Generation = {
        id: uid("gen"),
        userId: user.id,
        styleId: st.id,
        originalId,
        originalUrl,
        resultUrl: null,
        status: isDemo ? "done" : "processing",
        error: null,
        mode: consumed,
        provider: plan.provider,
        createdAt: now(),
        published: false,
      };
      d.generations.push(g);
      generations.push(g);
    }
  });

  // For real providers, actually run the generation and persist the result.
  const payload = [];
  for (const g of generations) {
    const st = targetStyles.find((s) => s.id === g.styleId)!;
    const plan = planGeneration(st);
    let status = g.status;
    let resultUrl = isDemo ? originalUrl : null;
    let provider = g.provider;
    let demoConfig = plan.demoConfig;
    let note = plan.note;

    if (!isDemo) {
      try {
        const res = await executeRealGeneration(plan, buffer, file.type);
        if (res) {
          resultUrl = res.resultUrl;
          provider = res.provider;
          status = "done";
          note = "Готово.";
          mutate((d) => {
            const rec = d.generations.find((x) => x.id === g.id);
            if (rec) {
              rec.status = "done";
              rec.resultUrl = res.resultUrl;
              rec.provider = res.provider;
              rec.error = null;
            }
          });
        } else {
          // Real provider selected but no API key configured — fall back to a
          // demo preview so the user is never stuck without a result.
          resultUrl = originalUrl;
          provider = "Demo (нет ключа)";
          status = "done";
          demoConfig = st.config;
          note = "Ключ ИИ не задан — показан демо-предпросмотр.";
          mutate((d) => {
            const rec = d.generations.find((x) => x.id === g.id);
            if (rec) {
              rec.status = "done";
              rec.resultUrl = originalUrl;
              rec.provider = provider;
            }
          });
        }
      } catch (e) {
        status = "failed";
        note = "Ошибка генерации: " + (e instanceof Error ? e.message : "unknown");
        mutate((d) => {
          const rec = d.generations.find((x) => x.id === g.id);
          if (rec) {
            rec.status = "failed";
            rec.error = e instanceof Error ? e.message : "unknown";
          }
        });
      }
    }

    payload.push({
      id: g.id,
      styleId: g.styleId,
      styleSlug: st.slug,
      originalUrl,
      resultUrl,
      status,
      provider,
      mode: g.mode,
      demoConfig,
      note,
      consumed,
      published: false,
    });
  }

  return NextResponse.json({ ok: true, scope, consumed, isDemo, unlimited, generations: payload });
}
