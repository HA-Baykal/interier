import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage } from "./helpers";
import { getTestProfile, MODEL_TEST_PROFILES, GENAPI_MODELS } from "../src/lib/generation/model-catalog";
import { buildGenApiImagePayload, assertGenApiImageType } from "../src/lib/generation/genapi-payload";
import { generationRequestSettings } from "../src/lib/generation/request-settings";

let cleanup: () => void;
let settings: typeof import("../src/lib/generation/settings");
before(async () => { cleanup = isolateStorage(); settings = await import("../src/lib/generation/settings"); });
after(() => cleanup());
const cfg = { provider: "genapi" as const, model: "gpt-image-2", baseUrl: "https://api.gen-api.ru", apiKey: "sk_test_catalog_private" };
const photo = "https://photos.example.test/original.jpg";

test("catalog profiles have unique IDs, dated price references, and cover three photo-edit models", () => {
  assert.equal(new Set(MODEL_TEST_PROFILES.map(p => p.id)).size, MODEL_TEST_PROFILES.length);
  assert.deepEqual(Object.keys(GENAPI_MODELS), ["gpt-image-2", "nano-banana", "nano-banana-pro"]);
  assert.equal(getTestProfile("nano-banana:standard")?.estimatedRub, 9.75);
  assert.equal(getTestProfile("nano-banana-pro:2k")?.estimatedRub, 37.5);
  assert.equal(getTestProfile("gpt-image-2:low")?.quality, "low");
  assert.equal(getTestProfile("__proto__"), undefined);
  assert.equal(getTestProfile("https://untrusted.example.test"), undefined);
});

test("GPT Image 2 keeps the existing image-edit contract and supports Low explicitly", () => {
  const body = buildGenApiImagePayload({ ...cfg, quality: "low" }, photo, "Keep the walls", "image/jpeg");
  assert.deepEqual(body, { prompt: "Keep the walls", image_urls: [photo], num_images: 1, output_format: "png", quality: "low", image_size: "1024x1024" });
});

test("Nano Banana never receives GPT-only quality or image_size fields, and translation is not purchased", () => {
  const body = buildGenApiImagePayload({ ...cfg, model: "nano-banana" }, photo, "Keep the walls", "image/jpeg");
  assert.deepEqual(body, { prompt: "Keep the walls", image_urls: [photo], num_images: 1, output_format: "png", translate_input: false, aspect_ratio: "default" });
});

test("Nano Banana Pro uses its documented resolution and aspect-ratio parameters", () => {
  const body = buildGenApiImagePayload({ ...cfg, model: "nano-banana-pro", resolution: "2K" }, photo, "Keep the walls", "image/png");
  assert.deepEqual(body, { prompt: "Keep the walls", image_urls: [photo], num_images: 1, output_format: "png", translate_input: false, aspect_ratio: "1:1", resolution: "2K" });
});

test("model-specific image type and unsupported model failures happen before a provider request", () => {
  assert.doesNotThrow(() => assertGenApiImageType("gpt-image-2", "image/webp"));
  assert.throws(() => assertGenApiImageType("nano-banana", "image/webp"), /JPEG/);
  assert.throws(() => assertGenApiImageType("nano-banana-pro", "image/webp"), /JPEG/);
  assert.throws(() => assertGenApiImageType("invented-model", "image/png"), /шаблона/);
});

test("an explicit admin test is real but cannot mutate the public demo configuration or credential destination", () => {
  const base = settings.resolveGenerationSettings([
    { key: "generation_mode", value: "demo" }, { key: "generation_mode_explicit", value: "1" },
    { key: "compatible_api_key", value: cfg.apiKey },
  ], {});
  const before = JSON.stringify(base);
  const resolved = generationRequestSettings(base, true, { scope: "single", testProfile: "nano-banana-pro:2k" });
  assert.equal(resolved.mode, "compatible");
  assert.equal(resolved.aiConfigured, true);
  assert.equal(resolved.compatible.model, "nano-banana-pro");
  assert.equal(resolved.compatible.quality, undefined);
  assert.equal(resolved.compatible.resolution, "2K");
  assert.equal(resolved.compatible.apiKey, cfg.apiKey);
  assert.equal(resolved.compatible.baseUrl, cfg.baseUrl);
  assert.equal(JSON.stringify(base), before);
});

test("test overrides require admin, one style, a configured GenAPI key, and an unambiguous catalog profile", () => {
  const base = settings.resolveGenerationSettings([{ key: "compatible_api_key", value: cfg.apiKey }], {});
  assert.throws(() => generationRequestSettings(base, false, { scope: "single", testProfile: "nano-banana:standard" }), /администратору/);
  assert.throws(() => generationRequestSettings(base, true, { scope: "all", testProfile: "nano-banana:standard" }), /один/);
  assert.throws(() => generationRequestSettings(base, true, { scope: "single", testProfile: "nano-banana:standard", quality: "high" }), /отдельного/);
  assert.throws(() => generationRequestSettings(base, true, { scope: "single", testProfile: "untrusted" }), /Неизвестный/);
  assert.throws(() => generationRequestSettings({ ...base, compatible: { ...base.compatible, provider: "openai-compatible" } }, true, { scope: "single", testProfile: "nano-banana:standard" }), /другого провайдера/);
  assert.throws(() => generationRequestSettings({ ...base, compatible: { ...base.compatible, apiKey: "" } }, true, { scope: "single", testProfile: "nano-banana:standard" }), /ключ/);
});
