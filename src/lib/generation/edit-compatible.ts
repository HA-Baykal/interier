/**
 * Image-edit connector supporting:
 *   1) GenAPI native REST (provider "genapi") — gen-api.ru
 *      POST https://api.gen-api.ru/api/v1/networks/{model_id}
 *      body: { prompt, image_urls: [publicPhotoUrl], quality, image_size, num_images, output_format }
 *      result via polling GET /api/v1/request/get/{request_id}
 *
 *   2) OpenAI-compatible image edit (provider "openai-compatible") — provod.ai etc.
 *      POST {base}/v1/images/edits  (multipart)
 *
 * Both are used from Russia with ruble payment. GenAPI receives the existing
 * public Blob URL on Vercel; local callers retain the legacy inline photo input.
 * OpenAI-compatible providers still receive a multipart file.
 */

import { providerHttpError, providerErrorDetail } from "../errors";
import { validateCompatibleConfig, type CompatibleConfig } from "./settings";
import { DEFAULT_IMAGE_QUALITY, GPT_IMAGE_2_SIZE } from "./quality";
export { getCompatibleConfig } from "./settings";
export type { CompatibleConfig, CompatibleProvider } from "./settings";

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

/** Use the existing Blob URL, not a URL built from the protected Preview host. */
function genApiPhotoInput(buffer: Buffer, mime: string, originalUrl?: string): string {
  if (!originalUrl || originalUrl.startsWith("/api/uploads/") || originalUrl.startsWith("data:")) {
    return toDataUri(buffer, mime);
  }
  let url: URL;
  try { url = new URL(originalUrl); } catch { throw new Error("Invalid original photo URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Original photo must have a public HTTPS URL without embedded credentials");
  }
  return url.href;
}

async function genApiRequest(
  cfg: CompatibleConfig,
  imageBuffer: Buffer,
  mime: string,
  prompt: string,
  originalUrl?: string
): Promise<{ outputUrl: string; provider: string }> {
  const endpoint = `${cfg.baseUrl}/api/v1/networks/${encodeURIComponent(cfg.model)}`;
  const deadline = Date.now() + 210_000;
  const imageUrl = genApiPhotoInput(imageBuffer, mime, originalUrl);

  // Polling needs no callback; omit the unused optional URL instead of sending null.
  // Model contract: https://gen-api.ru/model/gpt-image-2/api
  const payload = {
    prompt,
    image_urls: [imageUrl],
    quality: cfg.quality ?? DEFAULT_IMAGE_QUALITY,
    image_size: GPT_IMAGE_2_SIZE,
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
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw wrapFetchError(e, "GenAPI start");
  }

  if (!startRes.ok) {
    throw await providerHttpError(startRes, "GenAPI start", cfg.apiKey);
  }

  const startData = await startRes.json();
  const requestId = startData?.request_id;
  if (!requestId) throw new Error(`GenAPI start: ${providerErrorDetail(startData, [cfg.apiKey]) || "API did not return request_id"}`);

  // Poll for the result.
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (Date.now() >= deadline) break;
    let pollRes: Response;
    try {
      pollRes = await fetch(`${cfg.baseUrl}/api/v1/request/get/${encodeURIComponent(String(requestId))}`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      });
    } catch (e) {
      throw wrapFetchError(e, "GenAPI poll");
    }
    if (!pollRes.ok) {
      throw await providerHttpError(pollRes, "GenAPI poll", cfg.apiKey);
    }
    const d = await pollRes.json();
    if (d.status === "success") {
      let url = Array.isArray(d.result) ? d.result[0] : null;
      if (!url && Array.isArray(d.output)) url = d.output[0];
      if (typeof url !== "string" || !url) throw new Error("GenAPI success but no result URL");
      return { outputUrl: url, provider: cfg.model };
    }
    if (d.status === "error") {
      throw new Error(`GenAPI error: ${providerErrorDetail(d, [cfg.apiKey]) || "Провайдер не передал пояснение ошибки."}`);
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
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(210_000),
    });
  } catch (e) {
    throw wrapFetchError(e, "Image edit");
  }

  if (!res.ok) {
    throw await providerHttpError(res, "Image edit", cfg.apiKey);
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
  prompt: string,
  originalUrl?: string
): Promise<CompatibleResult> {
  validateCompatibleConfig(cfg);
  if (cfg.provider === "openai-compatible") {
    return openAiCompatibleRequest(cfg, imageBuffer, mime, prompt);
  }
  return genApiRequest(cfg, imageBuffer, mime, prompt, originalUrl);
}
