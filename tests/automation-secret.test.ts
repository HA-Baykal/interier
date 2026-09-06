import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAutomationSecret } from "../src/lib/automation-secret";

test("the Vercel setup helper produces exactly 32 hexadecimal characters", () => {
  const value = generateAutomationSecret();
  assert.equal(value.length, 32);
  assert.match(value, /^[0-9a-f]{32}$/);
});

test("the helper uses Web Crypto and preserves leading zero bytes", t => {
  let requested = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", (array: Uint8Array) => {
    requested = array.byteLength;
    array.fill(0); array[15] = 255;
    return array;
  });
  assert.equal(generateAutomationSecret(), "00".repeat(15) + "ff");
  assert.equal(requested, 16);
});
