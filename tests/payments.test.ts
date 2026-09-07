import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyYooSignature } from "../src/lib/payments";

test("verifyYooSignature: принимает корректную base64-подпись ЮKassa", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ type: "payment.succeeded", object: { id: "p_1" } });
  const sig = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  assert.equal(verifyYooSignature(body, sig, secret), true);
});

test("verifyYooSignature: принимает hex-подпись (fallback)", () => {
  const secret = "test-secret";
  const body = '{"a":1}';
  const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  assert.equal(verifyYooSignature(body, sig, secret), true);
});

test("verifyYooSignature: отклоняет чужую подпись и пустую", () => {
  const secret = "test-secret";
  const body = '{"a":1}';
  const good = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  assert.equal(verifyYooSignature(body, good, "other-secret"), false);
  assert.equal(verifyYooSignature(body, "AAAA", secret), false);
  assert.equal(verifyYooSignature(body, "", secret), false);
});
