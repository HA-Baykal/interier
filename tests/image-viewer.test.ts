import { test } from "node:test";
import assert from "node:assert/strict";
import { clampComparison, comparisonClip, comparisonKey, dragComparison, fitImage } from "../src/lib/image-viewer";

test("the center is left BEFORE / right AFTER; the extremes reveal a full image", () => {
  assert.equal(comparisonClip(50), "inset(0 50% 0 0)");
  assert.equal(comparisonClip(0), "inset(0 100% 0 0)");
  assert.equal(comparisonClip(100), "inset(0 0% 0 0)");
});
test("pointer and touch drags use a percentage of the actual (possibly zoomed) frame", () => {
  assert.equal(dragComparison(50, 100, 400), 75);
  assert.equal(dragComparison(50, 100, 800), 62.5);
  assert.equal(dragComparison(50, -900, 400), 0);
  assert.equal(dragComparison(50, 900, 400), 100);
  assert.equal(dragComparison(50, 100, 0), 50);
});
test("keyboard slider actions support arrows, larger steps, Home and End", () => {
  assert.equal(comparisonKey(50, "ArrowLeft"), 49);
  assert.equal(comparisonKey(50, "ArrowRight", true), 60);
  assert.equal(comparisonKey(50, "Home"), 0);
  assert.equal(comparisonKey(50, "End"), 100);
  assert.equal(comparisonKey(99, "ArrowRight", true), 100);
  assert.equal(comparisonKey(50, "Escape"), null);
});
test("invalid positions are safe, and fit never stretches a photo's proportions", () => {
  assert.equal(clampComparison(NaN), 50);
  assert.equal(clampComparison(-1), 0);
  assert.equal(clampComparison(101), 100);
  assert.deepEqual(fitImage(1600, 900, 800, 800), { width: 800, height: 450 });
  assert.deepEqual(fitImage(100, 200, 800, 800), { width: 100, height: 200 });
  assert.deepEqual(fitImage(0, 200, 800, 800), { width: 1, height: 1 });
});
