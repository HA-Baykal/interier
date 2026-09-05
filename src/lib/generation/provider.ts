import { Style, StyleConfig } from "../types";
import { getGenerationSettings, type CompatibleConfig } from "./settings";
import { defaultReplicateConfig, runReplicate, type ReplicateConfig } from "./replicate";
import {
  getCompatibleConfig,
  buildInteriorEditPrompt,
  runCompatibleEdit,
} from "./edit-compatible";
import { saveUpload, resolveImageUrl, imageMime } from "@/app/api/upload/service";

/**
 * Pluggable generation provider (path #1 — Russian API aggregator).
 *
 * mode: "demo"        -> the client renders a realistic style preview locally.
 * mode: "compatible"  -> calls a Russian image-edit endpoint (GenAPI / provod.ai)
 *                        with a structure-preserving interior prompt. BEST for our
 *                        requirement: walls, windows, doors and floor plan stay
 *                        untouched.
 * mode: "replicate"   -> legacy Replicate client (for reference).
 */

export type GenerationPlan = {
  provider: string;
  mode: string;
  /** Used by demo client-side rendering; null for real providers. */
  demoConfig: StyleConfig | null;
  /** For real providers the server builds a prompt from the style. */
  prompt: string | null;
  /** Human readable status to show during generation. */
  note: string;
  compatibleConfig?: CompatibleConfig;
  replicateConfig?: ReplicateConfig | null;
};

export async function planGeneration(
  style: Style,
  settings?: Awaited<ReturnType<typeof getGenerationSettings>>
): Promise<GenerationPlan> {
  const resolved = settings ?? await getGenerationSettings();
  const mode = resolved.mode;
  const prompt = buildInteriorEditPrompt(style.name.en, style.description.en);

  switch (mode) {
    case "compatible": {
      const cfg = resolved.compatible;
      return {
        provider: cfg?.provider === "openai-compatible" ? "provod.ai" : cfg?.model || "Image edit",
        mode,
        compatibleConfig: cfg,
        demoConfig: null,
        prompt,
        note: "Перерисовываем интерьер, сохраняя планировку...",
      };
    }
    case "replicate": {
      return {
        provider: "Replicate",
        mode,
        replicateConfig: defaultReplicateConfig(),
        demoConfig: null,
        prompt,
        note: "Обрабатываем через Replicate...",
      };
    }
    default: {
      return {
        provider: "Demo",
        mode: "demo",
        demoConfig: style.config,
        prompt: null,
        note: "Демо-режим: генерируем превью дизайна локально.",
      };
    }
  }
}

/**
 * Runs a real generation for the configured provider and returns a public
 * URL to the generated image (Blob on Vercel, uploads locally).
 * A missing/broken real provider is an error, never a fake demo success.
 */
export async function executeRealGeneration(
  plan: GenerationPlan,
  imageBuffer: Buffer,
  mime: string
): Promise<{ resultUrl: string; provider: string } | null> {
  if (!plan.prompt) return null;

  if (plan.mode === "compatible") {
    const cfg = plan.compatibleConfig ?? await getCompatibleConfig();
    if (!cfg?.apiKey) throw new Error("AI API key is not configured");
    const r = await runCompatibleEdit(cfg, imageBuffer, mime, plan.prompt);
    return await persistResult(r.outputUrl, r.provider);
  }

  if (plan.mode === "replicate") {
    const cfg = plan.replicateConfig ?? defaultReplicateConfig();
    if (!cfg) throw new Error("Replicate API token is not configured");
    const r = await runReplicate(cfg, imageBuffer, mime, plan.prompt);
    return await persistResult(r.outputUrl, "Replicate");
  }

  return null;
}

/** Download (or accept a data URI) and store the generated image. */
async function persistResult(
  outputUrl: string,
  provider: string
): Promise<{ resultUrl: string; provider: string }> {
  let buf: Buffer;
  let m: string;

  if (outputUrl.startsWith("data:")) {
    const match = outputUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URI from provider");
    m = match[1];
    buf = Buffer.from(match[2], "base64");
  } else {
    const url = new URL(outputUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid result URL from provider");
    const res = await fetch(outputUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Failed to download generated image (HTTP ${res.status})`);
    const limit = 20 * 1024 * 1024;
    if (Number(res.headers.get("content-length")) > limit) throw new Error("Generated image exceeds 20 MB");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Empty image response from provider");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) { await reader.cancel(); throw new Error("Generated image exceeds 20 MB"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    buf = Buffer.concat(chunks);
    m = imageMime(buf) || "";
  }

  if (buf.length > 20 * 1024 * 1024) throw new Error("Generated image exceeds 20 MB");
  const saved = await saveUpload(buf, m);
  return { resultUrl: resolveImageUrl(saved.url), provider };
}
