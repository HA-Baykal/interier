/**
 * Vision tagger: asks a multimodal model to look at the generated design and
 * return the purchasable interior details with normalized bounding boxes.
 *
 *   { "items": [ { "category": "curtains", "name": "Льняные шторы", … ,
 *                 "bbox": [x, y, w, h] } ] }
 *
 * Uses the OpenAI-compatible `chat/completions` endpoint of whatever aggregator
 * is configured (GenAPI / provod.ai), so no extra account or card is needed.
 * Every failure path returns null — the caller then falls back to the
 * deterministic text-based detector, and the user still gets a shopping list.
 */

import { getSettingOrEnv } from "../config";
import { normalizeText } from "../marketplaces";

export type VisionConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export type VisionRawItem = {
  category?: string;
  name?: string;
  nameEn?: string;
  query?: string;
  color?: string;
  material?: string;
  bbox?: number[];
  confidence?: number;
};

/** Resolve vision settings. "inherit" reuses the image-edit aggregator keys. */
export async function getVisionConfig(): Promise<VisionConfig | null> {
  const enabled = await getSettingOrEnv("vision_enabled");
  if (enabled === "0" || enabled.toLowerCase() === "off") return null;

  const provider = (await getSettingOrEnv("vision_provider")) || "inherit";
  const compatBase = await getSettingOrEnv("compatible_base_url", "COMPATIBLE_BASE_URL");
  const compatKey = await getSettingOrEnv("compatible_api_key", "COMPATIBLE_API_KEY");

  let baseUrl = (await getSettingOrEnv("vision_base_url", "VISION_BASE_URL")) || "";
  let apiKey = (await getSettingOrEnv("vision_api_key", "VISION_API_KEY")) || "";

  if (provider === "inherit" || !baseUrl || !apiKey) {
    baseUrl = baseUrl || compatBase || "https://api.gen-api.ru";
    apiKey = apiKey || compatKey;
  }
  const model = (await getSettingOrEnv("vision_model", "VISION_MODEL")) || "gpt-4o-mini";
  if (!baseUrl || !apiKey) return null;

  const timeoutMs = Number(await getSettingOrEnv("vision_timeout_ms")) || 60_000;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, timeoutMs };
}

/** `<base>/v1` for GenAPI-style bases, `<base>` when /v1 is already included. */
function chatEndpoint(baseUrl: string): string {
  if (/\/v\d+$/.test(baseUrl)) return `${baseUrl}/chat/completions`;
  if (/chat\/completions$/.test(baseUrl)) return baseUrl;
  if (/gen-api\.ru/i.test(baseUrl)) return `${baseUrl}/v1/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

const SYSTEM_PROMPT = [
  "You are an interior designer's assistant building a shopping list from a render.",
  "Look at the image and list the objects a client could actually buy.",
  "Answer with STRICT JSON only, no markdown fences, matching this schema:",
  '{"items":[{"category":"<id>","name":"<название на русском, 1-4 слова>",',
  '"nameEn":"<english name>","query":"<поисковый запрос на русском с цветом/материалом>",',
  '"color":"<цвет или null>","material":"<материал или null>",',
  '"bbox":[x,y,w,h],"confidence":0.0}]}',
  "bbox values are normalized to 0..1 (x,y = top-left corner, w,h = size) and must fit inside the image.",
  "Return at most 8 items, most prominent first. Do not invent items you cannot see.",
].join(" ");

const CATEGORY_HINTS =
  "Allowed category ids: sofa, sofa_corner, armchair, pouf, table_coffee, table_dining, table_side, desk, chair, bed, nightstand, wardrobe, dresser, tv_zone, shelf, curtains, tulle, blinds, pillows, blanket, rug, bed_textile, lighting_ceiling, lamp_floor, lamp_table, sconce, track_light, decor, plants, mirror, kitchen, kitchen_appliances, tiles, flooring, paint, door, bathroom, ceiling, balcony, hallway. Use \"other\" only if nothing else fits.";

export function buildVisionPrompt(opts?: { focus?: string[]; extra?: string }): string {
  const focus = opts?.focus?.length
    ? `Pay special attention to: ${opts.focus.join(", ")} — always include them if visible.\n`
    : "";
  return `${focus}${CATEGORY_HINTS}\n${opts?.extra || ""}`.trim();
}

/**
 * Ask the model for tagged items.
 * `imageDataUri` may be a data: URI; buffers are converted by the caller.
 */
export async function tagImage(
  cfg: VisionConfig,
  imageDataUri: string,
  prompt: string
): Promise<VisionRawItem[] | null> {
  const endpoint = chatEndpoint(cfg.baseUrl);
  const body = {
    model: cfg.model,
    temperature: 0.1,
    max_tokens: 1400,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: prompt || "List the purchasable items." },
          { type: "image_url", image_url: { url: imageDataUri } },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.warn("[vision] request failed:", e instanceof Error ? e.message : e);
    return null;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Some gateways reject response_format — retry once without it.
    if (res.status === 400 && /response_format|json/i.test(text)) {
      const { response_format: _drop, ...rest } = body;
      return retryWithoutFormat(endpoint, cfg, rest);
    }
    console.warn(`[vision] ${res.status}: ${text.slice(0, 240)}`);
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const content = extractContent(data);
  if (!content) return null;
  return parseItems(content);
}

async function retryWithoutFormat(endpoint: string, cfg: VisionConfig, body: unknown) {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const content = extractContent(await res.json());
    return content ? parseItems(content) : null;
  } catch {
    return null;
  }
}

/** Tolerant extraction of the assistant message from several response shapes. */
function extractContent(data: unknown): string | null {
  const root = data as Record<string, any>;
  const choice = Array.isArray(root?.choices) ? root.choices[0] : undefined;
  const msg = choice?.message?.content ?? choice?.text;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const texts = msg.filter((p) => typeof p?.text === "string").map((p) => p.text as string);
    if (texts.length) return texts.join(" ");
  }
  // GenAPI-style payloads sometimes nest the raw provider response.
  const nested = root?.result ?? root?.output ?? root?.data;
  if (nested && nested !== root) return extractContent(nested);
  if (Array.isArray(nested) && typeof nested[0] === "string") return nested[0];
  return null;
}

/** Parse the model output into raw items, forgiving about markdown fences. */
export function parseItems(text: string): VisionRawItem[] | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  candidates.push(text);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.objects)
        ? parsed.objects
        : null;
      if (arr) {
        return arr
          .filter((x: unknown) => x && typeof x === "object")
          .map((x: Record<string, unknown>) => ({
            category: typeof x.category === "string" ? normalizeCategoryToken(x.category) : undefined,
            name: typeof x.name === "string" ? x.name : typeof x.title === "string" ? (x.title as string) : undefined,
            nameEn: typeof x.nameEn === "string" ? (x.nameEn as string) : typeof x.name_en === "string" ? (x.name_en as string) : undefined,
            query: typeof x.query === "string" ? (x.query as string) : typeof x.search === "string" ? (x.search as string) : undefined,
            color: typeof x.color === "string" ? (x.color as string) : null,
            material: typeof x.material === "string" ? (x.material as string) : null,
            bbox: Array.isArray(x.bbox) ? (x.bbox as number[]) : Array.isArray(x.box) ? (x.box as number[]) : undefined,
            confidence: typeof x.confidence === "number" ? x.confidence : undefined,
          }));
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Models love free-form category names — fold them into our ids when obvious. */
function normalizeCategoryToken(raw: string): string {
  const v = normalizeText(raw).replace(/[_\s]+/g, "_");
  return v || "other";
}
