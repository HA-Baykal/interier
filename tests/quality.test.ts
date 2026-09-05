import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage } from "./helpers";
import {
  IMAGE_QUALITIES, DEFAULT_IMAGE_QUALITY, ADMIN_TEST_IMAGE_QUALITY, GPT_IMAGE_2_PRICE_ESTIMATES,
  GPT_IMAGE_2_SIZE, GPT_IMAGE_2_PRICE_SOURCE, isImageQuality, supportsImageQuality, type ImageQuality,
} from "../src/lib/generation/quality";
import { t as translate } from "../src/lib/i18n";

let cleanup: () => void;
let settings: typeof import("../src/lib/generation/settings");
let connector: typeof import("../src/lib/generation/edit-compatible");
before(async () => {
  cleanup = isolateStorage();
  settings = await import("../src/lib/generation/settings");
  connector = await import("../src/lib/generation/edit-compatible");
});
after(() => cleanup());
const cfg = { provider: "genapi" as const, baseUrl: "https://api.gen-api.ru", model: "gpt-image-2", apiKey: "sk_quality_fixture_not_real" };

test("the admin test starts at medium while existing clients keep high and the same image size", () => {
  assert.equal(ADMIN_TEST_IMAGE_QUALITY, "medium");
  assert.equal(DEFAULT_IMAGE_QUALITY, "high");
  assert.equal(GPT_IMAGE_2_SIZE, "1024x1024");
  assert.deepEqual(IMAGE_QUALITIES, ["medium", "high"]);
});

test("the price hints are tied to GPT Image 2, not applied to demo, Replicate or another model", () => {
  assert.equal(supportsImageQuality("compatible", "genapi", "gpt-image-2"), true);
  for (const [mode, provider, model] of [
    ["demo", "genapi", "gpt-image-2"], ["replicate", "genapi", "gpt-image-2"],
    ["compatible", "openai-compatible", "gpt-image-2"], ["compatible", "genapi", "nano-banana-pro"],
  ]) assert.equal(supportsImageQuality(mode, provider, model), false);
  assert.deepEqual(GPT_IMAGE_2_PRICE_ESTIMATES, { medium: 15, high: 55 });
  assert.equal(GPT_IMAGE_2_PRICE_SOURCE, "https://gen-api.ru/model/gpt-image-2");
});

test("a per-request choice does not become a global setting through the resolver", () => {
  const resolved = settings.resolveGenerationSettings([
    { key: "compatible_api_key", value: cfg.apiKey },
    { key: "compatible_quality", value: "medium" }, // Not a supported global setting.
  ], {});
  assert.equal(resolved.compatible.quality, undefined);
  const selected = { ...resolved.compatible, quality: "medium" as const };
  settings.validateCompatibleConfig(selected);
  assert.equal(resolved.compatible.quality, undefined);
});

test("invalid direct-call overrides fail before contacting the paid provider", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not be called"); });
  for (const quality of ["", "low", "ultra", "HIGH"]) {
    assert.equal(isImageQuality(quality), false);
    await assert.rejects(connector.runCompatibleEdit({ ...cfg, quality: quality as ImageQuality }, Buffer.from([]), "image/png", "test"), /Invalid AI quality/);
  }
  await assert.rejects(connector.runCompatibleEdit({ ...cfg, model: "nano-banana-pro", quality: "medium" }, Buffer.from([]), "image/png", "test"), /Invalid AI quality/);
  await assert.rejects(connector.runCompatibleEdit({ ...cfg, provider: "openai-compatible", quality: "medium" }, Buffer.from([]), "image/png", "test"), /Invalid AI quality/);
  assert.equal(calls, 0);
});

test("both translations show the selected per-image estimate and warn about the full multi-style total", () => {
  for (const locale of ["ru", "en"] as const) {
    assert.match(translate(locale, "studio_quality_medium_price", { price: 15 }), /≈15/);
    assert.match(translate(locale, "studio_quality_high_price", { price: 55 }), /≈55/);
    assert.match(translate(locale, "studio_gen_all_estimate", { count: 6, price: 90 }), /≈90/);
    assert.ok(!translate(locale, "studio_quality_estimate", { date: "2026-09-05" }).includes("{date}"));
  }
});
