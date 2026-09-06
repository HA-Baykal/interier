/**
 * Shopping-list orchestration.
 *
 * Turns a design (image + prompt + the user's own words) into a `ShoppingList`:
 * details with marketplace deep links, coordinates when the vision model gave
 * them (→ hover hotspots) and a plain list otherwise. Used by the web studio and
 * by all three messenger bots, so a design always carries the same list.
 */

import { DesignItem, ShoppingList } from "./types";
import {
  CATEGORIES,
  Category,
  DEFAULT_MARKETPLACES,
  MARKETPLACES,
  MarketplaceDef,
  buildLinks,
  buildQuery,
  categoryById,
  detectAttributes,
  heuristicItems,
  makeItem,
  matchCategories,
  normalizeBbox,
} from "./marketplaces";
import { getSetting, getSettingBool, getSettingNumber, getSettingOrEnv } from "./config";
import { findUpload } from "@/app/api/upload/service";
import { getVisionConfig, buildVisionPrompt, tagImage, VisionRawItem } from "./generation/vision";

export type ShoppingSettings = {
  enabled: boolean;
  auto: boolean;
  maxItems: number;
  marketplaces: MarketplaceDef[];
  extraParams: string;
  defaultMode: "hotspots" | "list";
  publicLinks: boolean;
};

const ALL_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));
const MARKETPLACE_LOOKUP = new Map(MARKETPLACES.map((m) => [m.id, m]));

export async function shoppingSettings(): Promise<ShoppingSettings> {
  const enabled = await getSettingBool("shopping_enabled", true);
  const auto = await getSettingBool("shopping_auto", true);
  const maxItems = Math.max(3, Math.min(16, await getSettingNumber("shopping_max_items", 8)));

  const raw = await getSettingOrEnv("shopping_marketplaces");
  const ids = (raw || DEFAULT_MARKETPLACES.join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const known = DEFAULT_MARKETPLACES.length
    ? ids
        .map((id) => MARKETPLACE_LOOKUP.get(id))
        .filter((m): m is MarketplaceDef => !!m)
    : [];
  const marketplaces = known.length ? known : DEFAULT_MARKETPLACES.map((id) => MARKETPLACE_LOOKUP.get(id)!).filter(Boolean);

  const extraParams = await getSettingOrEnv("shopping_extra_params");
  const defaultMode = ((await getSetting("shopping_default_mode")) || "hotspots") === "list" ? "list" : "hotspots";
  const publicLinks = await getSettingBool("shopping_public_links", false);

  return { enabled, auto, maxItems, marketplaces, extraParams, defaultMode, publicLinks };
}

/* ------------------------------------------------------------------ */
/* Image loading for the vision model                                  */
/* ------------------------------------------------------------------ */

/**
 * Read the design image and return it as a data URI.
 * Local uploads are read from disk (works offline and on file-storage hosts);
 * remote/blob URLs are fetched. Failures degrade to null → heuristic detector.
 */
export async function imageToDataUri(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  try {
    if (ref.startsWith("data:")) return ref;

    const local = ref.match(/\/api\/uploads\/([^/?#]+)/);
    if (local) {
      const name = decodeURIComponent(local[1]);
      const id = name.replace(/\.(jpg|jpeg|png|webp)$/i, "");
      const filePath = findUpload(id);
      if (filePath) {
        const fs = await import("fs");
        const buf = fs.readFileSync(filePath);
        const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }
      // Same-host absolute URL pointing at a local upload.
      if (/^https?:\/\//.test(ref)) {
        const res = await fetch(ref);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") || "image/jpeg";
        return `data:${mime.split(";")[0]};base64,${buf.toString("base64")}`;
      }
      return null;
    }

    if (/^https?:\/\//.test(ref)) {
      const res = await fetch(ref, { headers: { Accept: "image/*" } });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // Keep the vision request sane (~6 MB of base64).
      if (buf.length > 5 * 1024 * 1024) return null;
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
  } catch (e) {
    console.warn("[shopping] image load failed:", e instanceof Error ? e.message : e);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

export type DetectInput = {
  /** Image to analyse (result URL / upload id / data URI). */
  imageRef: string | null;
  /** Free texts: style name+description, the user's instruction, the prompt. */
  texts: (string | null | undefined)[];
  /** Categories the user explicitly asked to change. */
  targets?: string[];
  /** Tail appended to queries, usually the style ("в стиле лофт"). */
  styleTail?: string;
  /** Force list-only output even when boxes exist (used by bots). */
  allowHotspots?: boolean;
  settings?: ShoppingSettings;
};

export type DetectResult = {
  items: DesignItem[];
  detector: ShoppingList["detector"];
  note: string | null;
};

export async function detectDesignItems(input: DetectInput): Promise<DetectResult> {
  const settings = input.settings || (await shoppingSettings());
  if (!settings.enabled) {
    return { items: [], detector: "off", note: "Подбор магазинов отключён администратором." };
  }

  const visionEnabled = await getSettingBool("vision_enabled", true);
  const visionCfg = visionEnabled ? await getVisionConfig() : null;
  let items: DesignItem[] = [];
  let detector: ShoppingList["detector"] = "heuristic";
  let note: string | null = null;

  if (visionCfg) {
    const dataUri = await imageToDataUri(input.imageRef);
    if (dataUri) {
      const focus = (input.targets || [])
        .map((t) => ALL_MAP.get(t)?.en)
        .filter(Boolean) as string[];
      const raw = await tagImage(
        visionCfg,
        dataUri,
        buildVisionPrompt({
          focus,
          extra: [
            "The scene is a redesigned interior.",
            input.texts.filter(Boolean).join(" | ").slice(0, 700),
          ].join(" "),
        })
      );
      if (raw && raw.length) {
        items = normalizeVisionItems(raw, settings, input);
        detector = "ai";
      } else {
        note = "ИИ-разметка недоступна — список собран по описанию дизайна.";
      }
    } else {
      note = "Не удалось прочитать изображение для разметки — список собран по описанию.";
    }
  }

  if (!items.length) {
    items = heuristicItems([...input.texts, (input.targets || []).map((t) => ALL_MAP.get(t)?.ru).join(" ")], {
      enabled: settings.marketplaces,
      extraParams: settings.extraParams,
      limit: settings.maxItems,
      changedCategories: input.targets,
      styleTail: input.styleTail,
    });
    detector = "heuristic";
  }

  // Always make sure the explicitly requested change is present in the list.
  for (const t of input.targets || []) {
    if (!items.some((i) => i.category === t)) {
      const cat = ALL_MAP.get(t);
      if (!cat) continue;
      const attrs = detectAttributes(input.texts.filter(Boolean).join(" "));
      items.unshift(
        makeItem(
          {
            category: cat.id,
            color: attrs.color,
            material: attrs.material,
            source: "heuristic",
            changed: true,
            confidence: 0.99,
            query: buildQuery([attrs.color, attrs.material, cat.ru.toLowerCase(), attrs.feature, cat.tail]),
          },
          { enabled: settings.marketplaces, extraParams: settings.extraParams, defaultTail: input.styleTail }
        )
      );
    }
  }

  return { items: finalizeItems(items, settings), detector, note };
}

function normalizeVisionItems(
  raw: VisionRawItem[],
  settings: ShoppingSettings,
  input: DetectInput
): DesignItem[] {
  const out: DesignItem[] = [];
  for (const r of raw) {
    const attrText = [r.name, r.query, r.color, r.material].filter(Boolean).join(" ");
    const attr = detectAttributes(attrText);

    let category: Category | null = categoryById(r.category || undefined) || matchCategories(attrText)[0] || null;
    // Vision models return free-form labels; fold "curtain"→curtains etc.
    if (!category && r.category) {
      const guess = normalizeTextToken(r.category);
      category = CATEGORIES.find((c) => c.id.replace(/_/g, "").includes(guess)) || null;
    }

    const name = (r.name || category?.ru || "Деталь интерьера").trim();
    if (!name) continue;

    const query =
      (r.query || "").trim() ||
      buildQuery([
        r.color || attr.color,
        r.material || attr.material,
        (category ? category.ru : name).toLowerCase(),
        category?.tail,
      ]);

    const item = makeItem(
      {
        name,
        nameEn: r.nameEn || category?.en,
        category: category?.id || "other",
        query,
        color: r.color || attr.color,
        material: r.material || attr.material,
        bbox: normalizeBbox(r.bbox ?? null),
        confidence: typeof r.confidence === "number" ? r.confidence : 0.8,
        source: "ai",
        changed: !!category && (input.targets || []).includes(category.id),
      },
      { enabled: settings.marketplaces, extraParams: settings.extraParams, defaultTail: input.styleTail }
    );
    out.push(item);
  }
  return out;
}

function normalizeTextToken(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}

/** Dedupe, cap, sort, and decide whether hover hotspots are possible. */
export function finalizeItems(items: DesignItem[], settings: ShoppingSettings): DesignItem[] {
  const seen = new Set<string>();
  const out: DesignItem[] = [];
  const sorted = [...items].sort((a, b) => {
    if (!!b.changed !== !!a.changed) return b.changed ? 1 : -1;
    return b.confidence - a.confidence;
  });
  for (const it of sorted) {
    const key = `${it.category}|${normalizeTextToken(it.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= settings.maxItems) break;
  }
  return out.map((it) => ({
    ...it,
    // Rebuild links defensively (e.g. items stored before an admin change).
    links: it.links?.length
      ? it.links
      : buildLinks(it.query, {
          enabled: settings.marketplaces,
          extraParams: settings.extraParams,
          shops: categoryById(it.category)?.shops,
          kind: categoryById(it.category)?.kind,
        }),
  }));
}

export function buildShoppingList(
  items: DesignItem[],
  opts: { detector: ShoppingList["detector"]; note?: string | null; allowHotspots?: boolean }
): ShoppingList {
  const withBoxes = items.filter((i) => i.bbox && i.bbox.length === 4);
  const mode: ShoppingList["mode"] =
    opts.allowHotspots === false ? "list" : withBoxes.length >= 1 && withBoxes.length === items.length ? "hotspots" : "list";
  return {
    items,
    mode,
    detector: opts.detector,
    note: opts.note ?? null,
    updatedAt: Date.now(),
  };
}

/** Text for messengers / captions: "🪟 Шторы — бежевые льняные" + links. */
export function shoppingToText(list: ShoppingList | null | undefined, locale: "ru" | "en" = "ru"): string {
  if (!list || !list.items.length) return locale === "ru" ? "Список покупок пуст." : "Shopping list is empty.";
  const lines: string[] = [];
  for (const it of list.items.slice(0, 10)) {
    const cat = categoryById(it.category);
    const emoji = cat?.emoji || "🛍️";
    const name = locale === "ru" ? it.name : it.nameEn || it.name;
    const marks = [it.changed ? (locale === "ru" ? "изменено" : "changed") : null].filter(Boolean);
    const head = `${emoji} ${name}${marks.length ? ` (${marks.join(", ")})` : ""}`;
    const links = it.links.map((l) => `${l.label}: ${l.url}`).join("  ");
    lines.push(`${head}\n${links}`);
  }
  return lines.join("\n\n");
}

export function relinkShopping(list: ShoppingList | null | undefined, settings: ShoppingSettings): ShoppingList | null {
  if (!list) return null;
  return {
    ...list,
    items: list.items.map((it) => ({
      ...it,
      links: buildLinks(it.query, {
        enabled: settings.marketplaces,
        extraParams: settings.extraParams,
        shops: categoryById(it.category)?.shops,
        kind: categoryById(it.category)?.kind,
      }),
    })),
  };
}
