/**
 * Single generation pipeline shared by the website and by all three bots.
 *
 * The web studio and a messenger chat must never diverge, so *all* business
 * logic of producing a design lives here: charge is decided by the caller, the
 * record is created here, the provider runs here, and the shopping list
 * (interior details + marketplace links) is attached here.
 */

import fs from "fs";
import { db, mutate, now, uid } from "../db";
import { addCredits } from "../billing";
import { BotPlatform, DesignItem, Generation, ShoppingList, Style, User } from "../types";
import { activeStyles } from "../config";
import { resolveImageUrl, saveUpload } from "@/app/api/upload/service";
import { executeRealGeneration, planGeneration } from "./provider";
import { getGenerationSettings, validateCompatibleConfig } from "./settings";
import { generationRequestSettings } from "./request-settings";
import { DEFAULT_IMAGE_QUALITY, supportsImageQuality, type ImageQuality } from "./quality";
import { assertFreeImageBudget } from "./free-quota";
import { getTestProfile } from "./model-catalog";
import { assertGenApiImageType } from "./genapi-payload";
import { enforceRateLimit } from "../security-store";
import { assertDurableDatabase, assertDurableUploads } from "../storage-config";
import { RequestError, safeErrorMessage } from "../errors";
import { buildInstructionPrompt, parseInstruction } from "./instruction";
import { buildShoppingList, detectDesignItems, finalizeItems, shoppingSettings } from "../shopping";
import { categoryById, buildQuery, detectAttributes, matchCategories } from "../marketplaces";

export type GenPayload = {
  id: string;
  styleId: string;
  styleSlug: string;
  styleName: { ru: string; en: string };
  originalUrl: string;
  resultUrl: string | null;
  status: Generation["status"];
  durationMs: number;
  provider: string;
  mode: Generation["mode"];
  quality: string | null;
  estimatedCostRub: number | null;
  demoConfig: Style["config"] | null;
  note: string | null;
  error: string | null;
  kind: "design" | "edit";
  instruction: string | null;
  parentGenerationId: string | null;
  changedCategories: string[];
  shopping: ShoppingList;
  published: boolean;
  createdAt: number;
};

/** Read an image reference (upload id, /api/uploads path, http url, data uri). */
export async function loadImageBytes(ref: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    if (ref.startsWith("data:")) {
      const m = ref.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      return { buffer: Buffer.from(m[2], "base64"), mime: m[1] };
    }
    const local = ref.match(/\/api\/uploads\/([^/?#]+)/);
    if (local) {
      const { findUpload } = await import("@/app/api/upload/service");
      const name = decodeURIComponent(local[1]);
      const id = name.replace(/\.(jpg|jpeg|png|webp)$/i, "");
      const p = findUpload(id);
      if (p) {
        const ext = p.split(".").pop()?.toLowerCase() || "jpg";
        return {
          buffer: fs.readFileSync(p),
          mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        };
      }
    }
    if (/^https?:\/\//.test(ref)) {
      const res = await fetch(ref, { headers: { Accept: "image/*" } });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      return { buffer, mime };
    }
  } catch (e) {
    console.warn("[generation] image load failed:", e instanceof Error ? e.message : e);
  }
  return null;
}

export type RunDesignParams = {
  user: User;
  style: Style;
  /** Source photo: already stored upload (design) or parent's result (edit). */
  source: { buffer: Buffer; mime: string };
  originalId: string;
  originalUrl: string;
  instruction?: string | null;
  parent?: Generation | null;
  origin?: BotPlatform | "web" | null;
  /** Skip the AI/vision detection (e.g. caller will do it later). */
  skipShopping?: boolean;
  /** "all" = the free trial renders this whole batch (web parity). */
  scope?: "single" | "all";
  /** Balance was already taken by the caller for a multi-style batch. */
  preCharged?: Charge;
  /**
   * Admin-only per-request overrides (Model Lab). Non-admins always get the
   * globally configured model/quality, exactly like the website does.
   */
  editInput?: { profileId?: string; quality?: string; resolution?: string; model?: string } | null;
};

export type Charge = { consumed: Generation["mode"]; freeBudgeted: boolean };

/**
 * Decide how a generation is paid for, with exactly the rules the website
 * uses: admin test mode is free, the first render burns the trial (counted
 * against the rolling global free-image budget), later renders a credit.
 * Used for a multi-style batch, where one trial covers the whole set.
 */
export async function chargeForGeneration(user: User, scope: "single" | "all" = "single"): Promise<Charge> {
  return mutate<Charge>((d) => {
    const current = d.users.find((x) => x.id === user.id);
    if (!current) throw new RequestError("unauthorized", "Требуется вход.", 401);
    if (await_unlimited(d) && current.isAdmin) return { consumed: "unlimited", freeBudgeted: false };
    if (!current.trialUsed) {
      current.trialUsed = true;
      assertFreeImageBudget(d, current, 1);
      return { consumed: "trial", freeBudgeted: current.isAdmin !== true };
    }
    if (scope === "all") throw new RequestError("no_trial", "Бесплатная генерация уже использована.", 403);
    if (current.credits <= 0) throw new RequestError("no_credits", "Недостаточно генераций на балансе.", 402);
    current.credits -= 1;
    return { consumed: "credit", freeBudgeted: false };
  });
}

function await_unlimited(d: { settings: { key: string; value: string }[] }): boolean {
  return d.settings.find((x) => x.key === "test_unlimited")?.value === "1";
}

/**
 * The one place a design is produced. Website and bots share it, so a photo
 * sent in Telegram behaves exactly like a upload on the site: same guards,
 * same provider selection, same record, same shopping list of purchasable
 * details.
 */
export async function runStyleGeneration(p: RunDesignParams): Promise<GenPayload> {
  // A deployment that cannot keep the result must say so, not half-generate.
  assertDurableDatabase();
  assertDurableUploads();
  await enforceRateLimit("generation", p.user.id, 6, 10 * 60_000);

  const base = await getGenerationSettings();
  const requestSettings = generationRequestSettings(base, p.user.isAdmin, {
    scope: p.scope ?? "single",
    quality: p.editInput?.quality as ImageQuality | undefined,
    testProfile: p.editInput?.profileId ?? undefined,
  });
  const cfg = requestSettings.compatible;
  const isDemo = requestSettings.mode === "demo";
  if (!isDemo && !requestSettings.aiConfigured) {
    throw new RequestError("ai_not_configured", "Ключ ИИ не настроен. Администратору нужно сохранить API-ключ в настройках.", 503);
  }
  const generationQuality = supportsImageQuality(requestSettings.mode, cfg.provider, cfg.model)
    ? cfg.quality ?? DEFAULT_IMAGE_QUALITY
    : undefined;
  const resolution = requestSettings.mode === "compatible" && cfg.provider === "genapi" && cfg.model === "nano-banana-pro"
    ? cfg.resolution ?? "2K"
    : undefined;
  const profile = p.editInput?.profileId ? getTestProfile(p.editInput.profileId) : undefined;
  if (requestSettings.mode === "compatible") {
    validateCompatibleConfig(cfg);
    // GenAPI rejects formats a model does not accept; check before charging.
    if (cfg.provider === "genapi") assertGenApiImageType(cfg.model, p.source.mime);
  }

  const instructionText = (p.instruction || "").trim() || null;
  const parsed = instructionText ? parseInstruction(instructionText) : null;

  // A targeted edit replaces the restyle prompt; a first generation with a
  // comment keeps the full restyle prompt and appends the wish to it.
  const promptOverride =
    parsed && p.parent
      ? buildInstructionPrompt({ styleNameEn: p.style.name.en, instruction: parsed })
      : parsed && instructionText
      ? `${buildInstructionPrompt({ styleNameEn: p.style.name.en, instruction: parsed })} Keep the overall ${p.style.name.en} styling of the room.`
      : null;

  const plan = await planGeneration(p.style, requestSettings, {
    promptOverride,
    instructionSummary: parsed?.summary,
  });

  const genId = uid("gen");
  const createdAt = now();

  // Balance and record are decided together: two parallel requests can never
  // spend the same trial or the same credit twice.
  const { consumed, freeBudgeted } = await mutate<Charge>((d) => {
    const current = d.users.find((x) => x.id === p.user.id);
    if (!current) throw new RequestError("unauthorized", "Требуется вход.", 401);
    let paid: Charge = { consumed: "unlimited", freeBudgeted: false };
    if (!p.preCharged) {
      const unlimited = await_unlimited(d) && current.isAdmin;
      if (!unlimited) {
        if (!current.trialUsed) {
          current.trialUsed = true;
          assertFreeImageBudget(d, current, 1);
          paid = { consumed: "trial", freeBudgeted: current.isAdmin !== true };
        } else {
          if (current.credits <= 0) throw new RequestError("no_credits", "Недостаточно генераций на балансе.", 402);
          current.credits -= 1;
          paid = { consumed: "credit", freeBudgeted: false };
        }
      }
    }
    d.generations.push({
      id: genId,
      userId: p.user.id,
      styleId: p.style.id,
      originalId: p.originalId,
      originalUrl: p.originalUrl,
      resultUrl: isDemo ? p.originalUrl : null,
      status: isDemo ? "done" : "processing",
      error: null,
      mode: paid.consumed,
      freeBudgeted: paid.freeBudgeted,
      provider: plan.provider,
      quality: generationQuality,
      resolution,
      testProfile: p.editInput?.profileId ?? undefined,
      estimatedCostRub: profile?.estimatedRub,
      createdAt,
      published: false,
      kind: p.parent ? "edit" : "design",
      instruction: instructionText,
      parentGenerationId: p.parent?.id ?? null,
      changedCategories: parsed?.targetCategories ?? [],
      shopping: null,
      origin: p.origin ?? "web",
    });
    return paid;
  });

  let resultUrl: string | null = isDemo ? p.originalUrl : null;
  let provider = plan.provider;
  let status: Generation["status"] = isDemo ? "done" : "processing";
  let note: string | null = plan.note;
  let error: string | null = null;
  const demoConfig: Style["config"] | null = isDemo ? p.style.config : null;
  const startedAt = Date.now();

  if (!isDemo) {
    try {
      // A Blob-stored original can be handed to the provider as a URL instead
      // of being re-uploaded as base64 (cheaper, and required by some models).
      const asUrl = /^https:\/\//.test(p.originalUrl) ? p.originalUrl : undefined;
      const res = await executeRealGeneration(plan, p.source.buffer, p.source.mime, asUrl);
      if (!res) throw new Error("AI provider returned no image");
      resultUrl = res.resultUrl;
      provider = res.provider;
      status = "done";
      note = "Готово.";
    } catch (e) {
      status = "failed";
      // Raw provider errors (and the key itself) never leave the server.
      error = safeErrorMessage(e, [base.compatible.apiKey]);
      note = "Ошибка генерации: " + error;
      // A failed render must not eat the user's credit.
      if (consumed === "credit") await addCredits(p.user.id, 1);
    }
  }
  const durationMs = Math.max(0, Date.now() - startedAt);

  // --- Shopping list (details of the design + "where to buy" links) ---------
  const shopping = p.skipShopping || status !== "done"
    ? buildShoppingList([], { detector: "off", note: null })
    : await detectShopping({
        imageRef: resultUrl,
        style: p.style,
        instruction: instructionText,
        targets: parsed?.targetCategories,
        prompt: plan.prompt,
      });

  await mutate((d) => {
    const rec = d.generations.find((g) => g.id === genId);
    if (!rec) return;
    rec.status = status;
    rec.resultUrl = resultUrl;
    rec.provider = provider;
    rec.error = error;
    rec.shopping = shopping;
    rec.durationMs = durationMs;
  });

  const styleName = { ru: p.style.name.ru, en: p.style.name.en };

  return {
    id: genId,
    styleId: p.style.id,
    styleSlug: p.style.slug,
    styleName,
    originalUrl: p.originalUrl,
    resultUrl,
    status,
    provider,
    mode: consumed,
    quality: generationQuality ?? null,
    estimatedCostRub: profile?.estimatedRub ?? null,
    durationMs,
    demoConfig,
    note,
    error,
    kind: p.parent ? "edit" : "design",
    instruction: instructionText,
    parentGenerationId: p.parent?.id ?? null,
    changedCategories: parsed?.targetCategories ?? [],
    shopping,
    published: false,
    createdAt,
  };
}

/**
 * "Change only the curtains" — take the *result* of a previous design, run a
 * targeted edit and attach a shopping list narrowed to the changed details.
 */
export async function runInstructionEdit(params: {
  user: User;
  generationId: string;
  instruction: string;
  styleOverrideId?: string | null;
  origin?: BotPlatform | "web" | null;
  /** Admin-only Model Lab overrides, forwarded as-is. */
  editInput?: RunDesignParams["editInput"];
}): Promise<{ payload: GenPayload } | { error: string }> {
  const d = await db();
  const parent = d.generations.find((g) => g.id === params.generationId);
  if (!parent) return { error: "not_found" };
  if (parent.userId !== params.user.id && !params.user.isAdmin) return { error: "forbidden" };
  if (parent.status !== "done" || !parent.resultUrl) return { error: "not_ready" };

  const styles = await activeStyles();
  const style =
    styles.find((s) => s.id === (params.styleOverrideId || parent.styleId)) || styles[0] || null;
  if (!style) return { error: "no_styles" };

  const ref = resolveImageUrl(parent.resultUrl);
  const img = await loadImageBytes(ref);
  if (!img) return { error: "no_image" };

  const saved = await saveUpload(img.buffer, img.mime);

  const payload = await runStyleGeneration({
    user: params.user,
    style,
    source: img,
    originalId: saved.id,
    originalUrl: saved.url,
    instruction: params.instruction,
    editInput: params.editInput ?? null,
    parent,
    origin: params.origin ?? "web",
  });

  return { payload };
}

/**
 * Manual pin: the user clicks a spot on the design and says what it is.
 * We cannot know the exact box, so we store a small marker box around the
 * click and give it full confidence — it is user data, not a guess.
 */
export async function addManualItem(params: {
  user: User;
  generationId: string;
  label: string;
  x: number;
  y: number;
}): Promise<{ item: DesignItem } | { error: string }> {
  const d = await db();
  const gen = d.generations.find((g) => g.id === params.generationId);
  if (!gen) return { error: "not_found" };
  if (gen.userId !== params.user.id && !params.user.isAdmin) return { error: "forbidden" };

  const settings = await shoppingSettings();
  const label = (params.label || "").trim().slice(0, 60);
  if (!label) return { error: "empty" };

  const cats = detectAttributes(label);
  const guessed = categoryById(matchFirstCategory(label));
  const attrs = { color: cats.color, material: cats.material };
  const query = buildQuery([
    attrs.color,
    attrs.material,
    (guessed?.ru || label).toLowerCase(),
    guessed?.tail,
  ]);

  const size = 0.12;
  const x = Math.max(0, Math.min(1 - size, params.x - size / 2));
  const y = Math.max(0, Math.min(1 - size, params.y - size / 2));

  const item: DesignItem = {
    id: uid("item"),
    name: label.charAt(0).toUpperCase() + label.slice(1),
    nameEn: label,
    category: guessed?.id || "other",
    query,
    color: attrs.color,
    material: attrs.material,
    bbox: [Number(x.toFixed(4)), Number(y.toFixed(4)), size, size],
    confidence: 1,
    source: "manual",
    links: [],
  };
  const [final] = finalizeItems([item], settings);

  await mutate((dd) => {
    const rec = dd.generations.find((g) => g.id === params.generationId);
    if (!rec) return;
    const list = rec.shopping || buildShoppingList([], { detector: "heuristic", note: null });
    rec.shopping = {
      ...list,
      items: [...list.items, final],
      // A manual pin always has coordinates, so hotspots stay meaningful.
      mode: list.items.some((i) => !i.bbox) ? list.mode : "hotspots",
      updatedAt: now(),
    };
  });

  return { item: final };
}

function matchFirstCategory(text: string): string | null {
  const hits = matchCategories(text);
  return hits[0]?.id || null;
}

/**
 * Re-run the detail detector for a stored design.
 *
 * Shared by the web "Обновить подбор" button and the bot, so both use exactly
 * the same prompt, the same marketplace configuration and the same limits.
 */
/**
 * Detect the purchasable details of a finished design and store them on the
 * record. Exported because the website route produces generations itself and
 * must end up with exactly the same data as the bot pipeline.
 */
export async function detectShopping(input: {
  imageRef: string | null;
  style: Style;
  instruction?: string | null;
  targets?: string[] | null;
  prompt?: string | null;
}): Promise<ShoppingList> {
  const settings = await shoppingSettings();
  if (!settings.enabled || !settings.auto || !input.imageRef) {
    return buildShoppingList([], { detector: "off", note: null });
  }
  try {
    return await runDetection(input, settings);
  } catch (e) {
    // A design that rendered successfully must never be lost because the
    // "where to buy" step (vision API) had a bad minute.
    console.warn("[shopping] detection failed:", e instanceof Error ? e.message : e);
    return buildShoppingList([], { detector: "off", note: "Не удалось собрать список деталей — попробуйте обновить его позже." });
  }
}

async function runDetection(input: Parameters<typeof detectShopping>[0], settings: Awaited<ReturnType<typeof shoppingSettings>>): Promise<ShoppingList> {
  const detection = await detectDesignItems({
    imageRef: input.imageRef,
    texts: [input.style.name.ru, input.style.name.en, input.style.description.ru, input.instruction || null, input.prompt?.slice(0, 400)],
    targets: input.targets ?? undefined,
    styleTail: `в стиле ${input.style.name.ru.toLowerCase()}`,
    settings,
  });
  return buildShoppingList(detection.items, { detector: detection.detector, note: detection.note });
}

/** Attach (and persist) the shopping list of an existing generation. */
export async function attachShoppingToGeneration(
  generationId: string,
  input: { instruction?: string | null; targets?: string[] | null } = {}
): Promise<ShoppingList | null> {
  const gen = (await db()).generations.find((g) => g.id === generationId);
  if (!gen || gen.status !== "done" || !gen.resultUrl) return null;
  const style = (await activeStyles()).find((s) => s.id === gen.styleId) || null;
  if (!style) return null;
  const shopping = await detectShopping({
    imageRef: gen.resultUrl,
    style,
    instruction: input.instruction ?? gen.instruction ?? null,
    targets: input.targets ?? gen.changedCategories ?? undefined,
    prompt: null,
  });
  await mutate((d) => {
    const rec = d.generations.find((g) => g.id === generationId);
    if (rec) rec.shopping = shopping;
  });
  return shopping;
}

export async function regenerateShopping(generationId: string): Promise<boolean> {
  const gen = (await db()).generations.find((g) => g.id === generationId);
  if (!gen) return false;
  const styles = await activeStyles();
  const style = styles.find((s) => s.id === gen.styleId) || null;
  const settings = await shoppingSettings();
  const imageRef = gen.resultUrl || gen.originalUrl || resolveImageUrl(gen.originalId);
  const detection = await detectDesignItems({
    imageRef,
    texts: [style?.name.ru, style?.name.en, style?.description.ru, gen.instruction],
    targets: gen.changedCategories || [],
    styleTail: style ? `в стиле ${style.name.ru.toLowerCase()}` : undefined,
    settings,
  });
  const list = buildShoppingList(detection.items, { detector: detection.detector, note: detection.note });
  await mutate((d) => {
    const rec = d.generations.find((g) => g.id === generationId);
    if (rec) rec.shopping = { ...list, updatedAt: now() };
  });
  return true;
}

/** Remove one detail from a stored shopping list. */
export async function removeItem(params: { user: User; generationId: string; itemId: string }) {
  const d = await db();
  const gen = d.generations.find((g) => g.id === params.generationId);
  if (!gen) return { error: "not_found" as const };
  if (gen.userId !== params.user.id && !params.user.isAdmin) return { error: "forbidden" as const };

  await mutate((dd) => {
    const rec = dd.generations.find((g) => g.id === params.generationId);
    if (!rec?.shopping) return;
    rec.shopping = {
      ...rec.shopping,
      items: rec.shopping.items.filter((i) => i.id !== params.itemId),
      updatedAt: now(),
    };
  });
  return { ok: true };
}
