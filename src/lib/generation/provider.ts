import { Style, StyleConfig } from "../types";
import { generationMode } from "../config";
import { defaultReplicateConfig, runReplicate } from "./replicate";
import {
  getCompatibleConfig,
  buildInteriorEditPrompt,
  runCompatibleEdit,
} from "./edit-compatible";
import { saveUpload } from "@/app/api/upload/service";

/**
 * Pluggable generation provider (path #1 — Russian API aggregator).
 *
 * mode: "demo"        -> the client renders a realistic style preview locally.
 * mode: "compatible"  -> calls an OpenAI-compatible image-edit endpoint
 *                        (provod.ai / GenAPI / etc.) with a structure-
 *                        preserving interior prompt. BEST for our requirement:
 *                        walls, windows, doors and floor plan stay untouched.
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
};

export function planGeneration(style: Style): GenerationPlan {
  const mode = generationMode();
  const prompt = buildInteriorEditPrompt(style.name.en, style.description.en);

  switch (mode) {
    case "compatible": {
      const cfg = getCompatibleConfig();
      return {
        provider: cfg?.model || "Image edit",
        mode,
        demoConfig: null,
        prompt,
        note: "Перерисовываем интерьер, сохраняя планировку...",
      };
    }
    case "replicate": {
      return {
        provider: "Replicate",
        mode,
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
 * URL to the generated image (saved into the local uploads store).
 * If no provider is configured / the call fails, it returns null so the
 * caller can fall back to demo. Throws only for hard, non-fallback errors.
 */
export async function executeRealGeneration(
  plan: GenerationPlan,
  imageBuffer: Buffer,
  mime: string
): Promise<{ resultUrl: string; provider: string } | null> {
  if (!plan.prompt) return null;

  if (plan.mode === "compatible") {
    const cfg = getCompatibleConfig();
    if (!cfg) return null; // key not configured -> stay in demo
    const r = await runCompatibleEdit(cfg, imageBuffer, mime, plan.prompt);
    return await persistResult(r.outputUrl, r.provider);
  }

  if (plan.mode === "replicate") {
    const cfg = defaultReplicateConfig();
    if (!cfg) return null; // key missing -> stay in demo
    const r = await runReplicate(cfg, imageBuffer, mime, plan.prompt);
    return await persistResult(r.outputUrl, "Replicate");
  }

  return null;
}

/** Download (or accept a data URI) and store the generated image locally. */
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
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error("Failed to download generated image");
    buf = Buffer.from(await res.arrayBuffer());
    const ext = (outputUrl.split("?")[0].split(".").pop() || "png").toLowerCase();
    m = ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  }

  const saved = saveUpload(buf, m);
  return { resultUrl: `/api/uploads/${saved.id}`, provider };
}
