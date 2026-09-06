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
import { activeStyles, generationMode } from "../config";
import { resolveImageUrl, saveUpload } from "@/app/api/upload/service";
import { executeRealGeneration, planGeneration } from "./provider";
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
  provider: string;
  mode: Generation["mode"];
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
  consumed: Generation["mode"];
  instruction?: string | null;
  parent?: Generation | null;
  origin?: BotPlatform | "web" | null;
  /** Skip the AI/vision detection (e.g. caller will do it later). */
  skipShopping?: boolean;
};

export async function runStyleGeneration(p: RunDesignParams): Promise<GenPayload> {
  const mode = await generationMode();
  const isDemo = mode !== "compatible" && mode !== "replicate";
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

  const plan = await planGeneration(p.style, {
    promptOverride,
    instructionSummary: parsed?.summary,
  });

  const genId = uid("gen");
  const createdAt = now();

  await mutate((d) => {
    const rec: Generation = {
      id: genId,
      userId: p.user.id,
      styleId: p.style.id,
      originalId: p.originalId,
      originalUrl: p.originalUrl,
      resultUrl: null,
      status: isDemo ? "done" : "processing",
      error: null,
      mode: p.consumed,
      provider: plan.provider,
      createdAt,
      published: false,
      kind: p.parent ? "edit" : "design",
      instruction: instructionText,
      parentGenerationId: p.parent?.id ?? null,
      changedCategories: parsed?.targetCategories ?? [],
      shopping: null,
      origin: p.origin ?? "web",
    };
    d.generations.push(rec);
  });

  let resultUrl: string | null = isDemo ? p.originalUrl : null;
  let provider = plan.provider;
  let status: Generation["status"] = isDemo ? "done" : "processing";
  let note: string | null = isDemo ? plan.note : plan.note;
  let error: string | null = null;
  let demoConfig: Style["config"] | null = isDemo ? p.style.config : null;

  if (!isDemo) {
    try {
      const res = await executeRealGeneration(plan, p.source.buffer, p.source.mime);
      if (res) {
        resultUrl = res.resultUrl;
        provider = res.provider;
        status = "done";
        note = "Готово.";
      } else {
        resultUrl = p.originalUrl;
        provider = "Demo (нет ключа)";
        status = "done";
        demoConfig = p.style.config;
        note = "Ключ ИИ не задан — показан демо-предпросмотр.";
      }
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : "unknown";
      note = "Ошибка генерации: " + error;
      // A failed render must not eat the user's credit.
      if (p.consumed === "credit") await addCredits(p.user.id, 1);
    }
  }

  // --- Shopping list (details of the design + "where to buy" links) ---------
  const settings = await shoppingSettings();
  let shopping: ShoppingList = buildShoppingList([], { detector: "off", note: null });

  if (settings.enabled && settings.auto && !p.skipShopping && status === "done") {
    const texts = [
      p.style.name.ru,
      p.style.name.en,
      p.style.description.ru,
      instructionText,
      plan.prompt?.slice(0, 400),
    ];
    const detection = await detectDesignItems({
      imageRef: resultUrl,
      texts,
      targets: parsed?.targetCategories,
      styleTail: `в стиле ${p.style.name.ru.toLowerCase()}`,
      settings,
    });
    shopping = buildShoppingList(detection.items, {
      detector: detection.detector,
      note: detection.note,
    });
  }

  await mutate((d) => {
    const rec = d.generations.find((g) => g.id === genId);
    if (!rec) return;
    rec.status = status;
    rec.resultUrl = resultUrl;
    rec.provider = provider;
    rec.error = error;
    rec.shopping = shopping;
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
    mode: p.consumed,
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
  consumed?: Generation["mode"];
  origin?: BotPlatform | "web" | null;
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
    consumed: params.consumed ?? "unlimited",
    instruction: params.instruction,
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
