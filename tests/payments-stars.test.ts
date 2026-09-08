import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let stars: typeof import("../src/lib/payments-stars");

before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db");
  stars = await import("../src/lib/payments-stars");
});
after(() => cleanup());

test("starsPriceFor rounds to whole Stars with a floor of 1", () => {
  assert.equal(stars.starsPriceFor(100, 1), 100);
  assert.equal(stars.starsPriceFor(100, 1.5), 150);
  assert.equal(stars.starsPriceFor(0.4, 1), 1, "never zero Stars");
  assert.equal(stars.starsPriceFor(99, 0.5), 50);
});

test("a successful Stars payment grants credits exactly once", async () => {
  await db.resetDb();
  await db.mutate((d) => {
    d.users.push({ ...TEST_USER, credits: 0 });
    d.payments.push({
      id: "pay_stars_test",
      yookassaId: "",
      userId: TEST_USER.id,
      packageId: "pkg_test",
      amountRub: 100,
      credits: 5,
      status: "pending",
      createdAt: Date.now(),
      provider: "stars",
      externalId: "pay_stars_test",
    });
  });

  const first = await stars.fulfillStarsPayment("stars:pay_stars_test", "tg_charge_1");
  assert.equal(first.granted, true);
  assert.equal(first.credits, 5);
  assert.equal((await db.db()).users[0].credits, 5);

  // Telegram redelivers the update; the second call must not credit again.
  const again = await stars.fulfillStarsPayment("stars:pay_stars_test", "tg_charge_1");
  assert.equal(again.granted, false);
  assert.equal((await db.db()).users[0].credits, 5);

  const stored = (await db.db()).payments.find((p) => p.id === "pay_stars_test")!;
  assert.equal(stored.status, "paid");
  assert.equal(stored.externalId, "tg_charge_1");
});

test("a foreign or malformed invoice payload grants nothing", async () => {
  await db.resetDb();
  await db.mutate((d) => d.users.push({ ...TEST_USER, credits: 3 }));
  const res = await stars.fulfillStarsPayment("not_ours", "charge");
  assert.equal(res.granted, false);
  assert.equal((await db.db()).users[0].credits, 3);
});
