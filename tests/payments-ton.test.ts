import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let ton: typeof import("../src/lib/payments-ton");

before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db");
  ton = await import("../src/lib/payments-ton");
});
after(() => cleanup());

test("tonAmountNano converts rubles to whole nanoton with a floor of 1", () => {
  assert.equal(ton.tonAmountNano(100, 0.01), 1000000000n, "100₽ × 0.01 = 1 TON = 1e9 nano");
  assert.equal(ton.tonAmountNano(0, 0.01), 1n, "never zero nano");
  assert.equal(ton.tonAmountNano(250, 0.02), 5000000000n, "250₽ × 0.02 = 5 TON");
});

test("a confirmed TON transfer grants credits exactly once", async () => {
  await db.resetDb();
  await db.mutate((d) => {
    d.users.push({ ...TEST_USER, credits: 0 });
    d.payments.push({
      id: "pay_ton_test",
      yookassaId: "",
      userId: TEST_USER.id,
      packageId: "pkg_test",
      amountRub: 100,
      credits: 7,
      status: "pending",
      createdAt: Date.now(),
      provider: "ton",
      externalId: "pay_ton_test",
    });
  });

  const first = await ton.fulfillTonPayment("pay_ton_test", "tx_hash_1");
  assert.equal(first.granted, true);
  assert.equal(first.credits, 7);
  assert.equal((await db.db()).users[0].credits, 7);

  // A repeated confirmation (poll/retry) must not credit again.
  const again = await ton.fulfillTonPayment("pay_ton_test", "tx_hash_1");
  assert.equal(again.granted, false);
  assert.equal((await db.db()).users[0].credits, 7);

  const stored = (await db.db()).payments.find((p) => p.id === "pay_ton_test")!;
  assert.equal(stored.status, "paid");
  assert.equal(stored.externalId, "tx_hash_1");
});

test("verifying an unknown TON payment reports unknown and grants nothing", async () => {
  await db.resetDb();
  await db.mutate((d) => d.users.push({ ...TEST_USER, credits: 2 }));
  const res = await ton.verifyTonPayment("pay_does_not_exist");
  assert.equal(res.status, "unknown");
  assert.equal(res.granted, false);
  assert.equal((await db.db()).users[0].credits, 2);
});
