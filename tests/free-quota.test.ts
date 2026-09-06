import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFreeImageBudget, DEFAULT_FREE_IMAGE_LIMIT, FREE_WINDOW_MS } from "../src/lib/generation/free-quota";
import type { DbShape, Generation } from "../src/lib/types";
import { TEST_USER } from "./helpers";

const customer = { ...TEST_USER, isAdmin: false };
function data(limit = "10", generations: Generation[] = []): DbShape {
  return { users: [customer], sessions: [], generations, rewards: [], referrals: [], styles: [], packages: [], settings: [{ key: "daily_free_image_limit", value: limit }], botChats: [], botLinks: [] };
}
function entry(createdAt: number, status: Generation["status"] = "failed"): Generation {
  return { id: String(createdAt), userId: customer.id, styleId: "style_modern", originalId: "img", resultUrl: null, status, error: null, provider: "gpt-image-2", mode: "trial", createdAt, published: false, freeBudgeted: true };
}

test("free budget counts images, including failed starts, rather than one batch as one request", () => {
  const now = Date.now();
  const records = Array.from({ length: 6 }, (_, i) => entry(now - i));
  assert.equal(DEFAULT_FREE_IMAGE_LIMIT, 10);
  assert.doesNotThrow(() => assertFreeImageBudget(data("10", records), customer, 4, now));
  assert.throws(() => assertFreeImageBudget(data("10", records), customer, 6, now), /лимит/);
});
test("zero/malformed settings fail closed; old entries expire from the rolling window", () => {
  const now = Date.now();
  assert.throws(() => assertFreeImageBudget(data("0"), customer, 1, now), /лимит/);
  assert.throws(() => assertFreeImageBudget(data("invalid"), customer, 1, now), /лимит/);
  assert.doesNotThrow(() => assertFreeImageBudget(data("1", [entry(now - FREE_WINDOW_MS - 1)]), customer, 1, now));
});
test("administrator tests and already-credit-paid users do not consume the free budget", () => {
  assert.doesNotThrow(() => assertFreeImageBudget(data("0"), TEST_USER, 6));
  assert.doesNotThrow(() => assertFreeImageBudget(data("0"), { ...customer, trialUsed: true }, 1));
});
