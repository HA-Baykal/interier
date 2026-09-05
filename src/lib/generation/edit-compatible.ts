/**
 * Generic OpenAI-compatible image edit client.
 *
 * With path #1 (Russian API aggregators) we get access to high-quality
 * *editing* models that preserve the input structure — e.g. Nano Banana
 * (Google Gemini edit) or GPT Image. These are exactly what we need so the
 * room's walls, windows, doors and floor plan stay untouched and only the
 * interior is re-styled.
 *
 * The aggregator (provod.ai, GenAPI, ...) exposes an OpenAI-compatible
 * `POST {base_url}/v1/images/edits` endpoint that accepts a file + prompt and
 * returns the edited image. Connection details (base URL, key, model) are
 * configured in the admin panel.
 */

import { getSetting } from "../config";

export type CompatibleConfig = {
  /** e.g. "https://api.provod.ai/v1" (must include /v1 suffix). */
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getCompatibleConfig(): CompatibleConfig | null {
  const baseUrl =
    getSetting("compatible_base_url") || process.env.COMPATIBLE_BASE_URL || "";
  const apiKey =
    getSetting("compatible_api_key") || process.env.COMPATIBLE_API_KEY || "";
  const model =
    getSetting("compatible_model") || process.env.COMPATIBLE_MODEL || "google/nano-banana";
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

/**
 * Build the strongest structure-preserving interior prompt for the given style.
 * Everything structural is explicitly frozen; only materials / furniture /
 * color / decor may change.
 */
export function buildInteriorEditPrompt(styleNameEn: string, styleDescEn: string): string {
  return [
    `Redesign the interior of this room into a professional "${styleNameEn}" style. ${styleDescEn}`,
    `CRITICAL — PRESERVE THE STRUCTURE EXACTLY:`,
    `- Do NOT change, move, add or remove any walls, wall openings, room layout or floor plan.`,
    `- Do NOT change any windows, window frames, glass, doors or door frames — keep them identical.`,
    `- Do NOT change the ceiling, ceiling height or architectural features.`,
    `- Do NOT change the view through the windows, the floor plan geometry or the camera perspective.`,
    `- Keep the aspect ratio, composition and perspective exactly the same.`,
    `ONLY change the interior styling: furniture, materials, wall paint/finish, floor finish, textiles,`,
    `lighting fixtures, decor and colors — make them look like a high-end designer project.`,
    `Professional interior photography, photorealistic, natural lighting, sharp, high quality,`,
    `cohesive color palette, no watermarks, no text, no people.`,
  ].join(" ");
}

function toFilename(mime: string): string {
  if (mime.includes("png")) return "room.png";
  if (mime.includes("webp")) return "room.webp";
  return "room.jpg";
}

export type CompatibleResult = {
  outputUrl: string;
  provider: string;
};

export async function runCompatibleEdit(
  cfg: CompatibleConfig,
  imageBuffer: Buffer,
  mime: string,
  prompt: string
): Promise<CompatibleResult> {
  const form = new FormData();
  form.append("model", cfg.model);
  form.append("image", new Blob([new Uint8Array(imageBuffer)], { type: mime }), toFilename(mime));
  form.append("prompt", prompt);
  // Square is safest for edit models; many edit APIs accept only 1024 square.
  form.append("size", "1024x1024");
  form.append("n", "1");

  const endpoint = `${cfg.baseUrl}/images/edits`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      // Do NOT set Content-Type; the browser/undici sets the multipart boundary.
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image edit failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const first = Array.isArray(data.data) ? data.data[0] : null;
  if (!first) throw new Error("Image edit returned no result");

  const url = first.url;
  const b64 = first.b64_json;
  if (typeof url === "string" && url) {
    return { outputUrl: url, provider: cfg.model };
  }
  if (typeof b64 === "string" && b64) {
    // Convert base64 to a local upload so we control storage.
    return { outputUrl: `data:image/png;base64,${b64}`, provider: cfg.model };
  }
  throw new Error("Image edit returned neither url nor b64_json");
}
