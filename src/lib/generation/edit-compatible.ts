/**
 * Image-edit connector supporting:
 *   1) GenAPI native REST (provider "genapi") — gen-api.ru
 *      POST https://api.gen-api.ru/api/v1/networks/{model_id}
 *      body: { prompt, image_urls: [dataUri], quality, image_size, num_images, output_format }
 *      result via polling GET /api/v1/request/get/{request_id}
 *
 *   2) OpenAI-compatible image edit (provider "openai-compatible") — provod.ai etc.
 *      POST {base}/v1/images/edits  (multipart)
 *
 * Both are used from Russia with ruble payment. We pass the uploaded room photo
 * as a data URI so no public hosting / localhost reachability is needed.
 */

import { getSetting } from "../config";

export type CompatibleProvider = "genapi" | "openai-compatible";

export type CompatibleConfig = {
  provider: CompatibleProvider;
  /** For genapi: "https://api.gen-api.ru". For openai-compatible: "https://api.provod.ai/v1". */
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getCompatibleConfig(): CompatibleConfig | null {
  const provider: CompatibleProvider =
    (getSetting("compatible_provider") as CompatibleProvider) || "genapi";
  const defaultBase = provider === "openai-compatible" ? "https://api.provod.ai/v1" : "https://api.gen-api.ru";
  const baseUrl =
    getSetting("compatible_base_url") || process.env.COMPATIBLE_BASE_URL || defaultBase;
  const apiKey =
    getSetting("compatible_api_key") || process.env.COMPATIBLE_API_KEY || "";
  let model =
    getSetting("compatible_model") || process.env.COMPATIBLE_MODEL || "gpt-image-2";
  // GenAPI uses the bare model id (e.g. "gpt-image-2", "nano-banana-pro").
  // Some OpenAI-style names carry a provider prefix ("google/nano-banana",
  // "openai/gpt-image-2") — strip it for the native GenAPI endpoint.
  if (provider === "genapi" && model.includes("/")) {
    model = model.slice(model.lastIndexOf("/") + 1);
  }
  if (!baseUrl || !apiKey || !model) return null;
  return { provider, baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

/**
 * Strong structure-preserving interior prompt. Structural elements (walls,
 * window/door openings, floor plan, perspective, ceiling, view) are frozen;
 * only styling may change.
 */
export function buildInteriorEditPrompt(styleNameEn: string, styleDescEn: string): string {
  return [
    `Redesign the interior of this room into a professional "${styleNameEn}" style. ${styleDescEn}`,
    `CRITICAL — PRESERVE THE STRUCTURE EXACTLY:`,
    `- Do NOT change, move, add or remove any walls, wall openings, room layout, floor plan or partition walls.`,
    `- Do NOT change any windows, window frames, glass, doors, door frames or archways — keep them identical.`,
    `- Do NOT change the ceiling, ceiling height or any architectural features.`,
    `- Do NOT change the view through any window, or the camera angle / perspective / composition.`,
    `- Keep the exact same room geometry and aspect ratio.`,
    `ONLY change the interior styling: furniture, materials, wall paint/finish, floor finish, textiles,`,
    `lighting fixtures, decor, accessories and colors — make it look like a high-end professional design.`,
    `Professional interior photography, photorealistic, natural lighting, sharp details, cohesive palette,`,
    `no watermarks, no text, no people, no objects added outside the room.`,
  ].join(" ");
}

/* ---------------- GenAPI native ---------------- */

/** Surface a helpful message for transport-level fetch failures. */
function wrapFetchError(err: unknown, context: string): Error {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network/i.test(String(err))) {
    return new Error(
      `${context}: не удалось подключиться к API (${cause?.code || cause?.message || err}). ` +
        `Если вы тестируете в песочнице без интернета, разверните проект на хостинге или запустите локально.`
    );
  }
  return err instanceof Error ? err : new Error(context + ": " + String(err));
}

function toDataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function genApiRequest(
  cfg: CompatibleConfig,
  imageBuffer: Buffer,
  mime: string,
  prompt: string
): Promise<{ outputUrl: string; provider: string }> {
  const endpoint = `${cfg.baseUrl}/api/v1/networks/${cfg.model}`;
  const imageUrl = toDataUri(imageBuffer, mime);

  const payload = {
    callback_url: null,
    prompt,
    image_urls: [imageUrl],
    quality: "high",
    image_size: "1024x1024",
    num_images: 1,
    output_format: "png",
  };

  let startRes: Response;
  try {
    startRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw wrapFetchError(e, "GenAPI start");
  }

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(`GenAPI start failed (${startRes.status}): ${text.slice(0, 300)}`);
  }

  const startData = await startRes.json();
  const requestId = startData.request_id;
  if (!requestId) throw new Error("GenAPI did not return request_id");

  // Poll for the result.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    let pollRes: Response;
    try {
      pollRes = await fetch(`${cfg.baseUrl}/api/v1/request/get/${requestId}`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
      });
    } catch (e) {
      throw wrapFetchError(e, "GenAPI poll");
    }
    if (!pollRes.ok) {
      const t = await pollRes.text().catch(() => "");
      throw new Error(`GenAPI poll failed (${pollRes.status}): ${t.slice(0, 200)}`);
    }
    const d = await pollRes.json();
    if (d.status === "success") {
      let url = Array.isArray(d.result) ? d.result[0] : null;
      if (!url && Array.isArray(d.output)) url = d.output[0];
      if (typeof url !== "string" || !url) throw new Error("GenAPI success but no result URL");
      return { outputUrl: url, provider: cfg.model };
    }
    if (d.status === "error") {
      const msg = d.error || d.full_response?.[0]?.error || "unknown error";
      throw new Error(`GenAPI error: ${JSON.stringify(msg)}`);
    }
  }

  throw new Error("GenAPI generation timed out");
}

/* ---------------- OpenAI-compatible edit ---------------- */

function toFilename(mime: string): string {
  if (mime.includes("png")) return "room.png";
  if (mime.includes("webp")) return "room.webp";
  return "room.jpg";
}

async function openAiCompatibleRequest(
  cfg: CompatibleConfig,
  imageBuffer: Buffer,
  mime: string,
  prompt: string
): Promise<{ outputUrl: string; provider: string }> {
  const form = new FormData();
  form.append("model", cfg.model);
  form.append("image", new Blob([new Uint8Array(imageBuffer)], { type: mime }), toFilename(mime));
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("n", "1");

  const endpoint = `${cfg.baseUrl}/images/edits`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        // no Content-Type: multipart boundary is set automatically
      },
      body: form,
    });
  } catch (e) {
    throw wrapFetchError(e, "Image edit");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image edit failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const first = Array.isArray(data.data) ? data.data[0] : null;
  if (!first) throw new Error("Image edit returned no result");

  if (typeof first.url === "string" && first.url) {
    return { outputUrl: first.url, provider: cfg.model };
  }
  if (typeof first.b64_json === "string" && first.b64_json) {
    return { outputUrl: `data:image/png;base64,${first.b64_json}`, provider: cfg.model };
  }
  throw new Error("Image edit returned neither url nor b64_json");
}

export type CompatibleResult = { outputUrl: string; provider: string };

export async function runCompatibleEdit(
  cfg: CompatibleConfig,
  imageBuffer: Buffer,
  mime: string,
  prompt: string
): Promise<CompatibleResult> {
  if (cfg.provider === "openai-compatible") {
    return openAiCompatibleRequest(cfg, imageBuffer, mime, prompt);
  }
  return genApiRequest(cfg, imageBuffer, mime, prompt);
}
