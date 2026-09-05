/**
 * Replicate client for interior-design models.
 *
 * The `adirik/interior-design` model is purpose-built for exactly this product:
 * it takes a photo of a room plus a text prompt and returns a photorealistic
 * redesign that (mostly) preserves the original room layout.
 *
 * API reference:
 *   https://replicate.com/adirik/interior-design/api
 *
 * We call the "latest version" endpoint, so we don't need to hard-code a
 * version hash — Replicate always runs the newest published version.
 */

export type ReplicateConfig = {
  token: string;
  modelOwner: string;
  modelName: string;
};

export function defaultReplicateConfig(): ReplicateConfig | null {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return null;
  return {
    token,
    modelOwner: process.env.REPLICATE_MODEL_OWNER || "adirik",
    modelName: process.env.REPLICATE_MODEL_NAME || "interior-design",
  };
}

function toDataUri(buffer: Buffer, mime: string): string {
  const b64 = buffer.toString("base64");
  return `data:${mime};base64,${b64}`;
}

export type ReplicateResult = {
  outputUrl: string;
  seconds: number;
  id: string;
};

/**
 * Runs a synchronous prediction (blocks up to `timeout` seconds).
 * Returns the resulting image URL.
 */
export async function runReplicate(
  config: ReplicateConfig,
  imageBuffer: Buffer,
  mime: string,
  prompt: string
): Promise<ReplicateResult> {
  const started = Date.now();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };

  const body = {
    input: {
      image: toDataUri(imageBuffer, mime),
      prompt,
      negative_prompt:
        "blurry, low quality, distorted, extra walls, wrong furniture, watermark, text",
    },
    prefer: { wait: { interval: 1000, timeout: 90 } },
  };

  const url = `https://api.replicate.com/v1/models/${config.modelOwner}/${config.modelName}/predictions`;

  let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate start failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let data = await res.json();

  // If `prefer.wait` timed out, Replicate returns status "processing" with an id — poll.
  const id = data.id;
  const deadline = Date.now() + 90_000;
  while (data.status !== "succeeded" && data.status !== "failed") {
    if (Date.now() > deadline) {
      throw new Error("Replicate prediction timed out");
    }
    await new Promise((r) => setTimeout(r, 1200));
    res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Replicate poll failed (${res.status}): ${text.slice(0, 300)}`);
    }
    data = await res.json();
  }

  if (data.status === "failed") {
    throw new Error(`Replicate prediction failed: ${data.error || "unknown error"}`);
  }

  const raw = data.output;
  const outputUrl = Array.isArray(raw) ? raw[0] : raw;
  if (typeof outputUrl !== "string") {
    throw new Error("Replicate returned no image");
  }

  return {
    outputUrl,
    seconds: Math.round((Date.now() - started) / 1000),
    id,
  };
}
