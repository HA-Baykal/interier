import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let config: typeof import("../src/lib/config");
let ton: typeof import("../src/lib/payments-ton");

before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db");
  config = await import("../src/lib/config");
  ton = await import("../src/lib/payments-ton");
});
after(() => cleanup());

/** Raw 0:<64 hex> address of the well-known zero key, and its friendly forms. */
const RAW = "0:0000000000000000000000000000000000000000000000000000000000000000";
const FRIENDLY_BOUNCEABLE = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const OTHER_RAW = "0:1111111111111111111111111111111111111111111111111111111111111111";

test("sameTonAddress treats raw and friendly spellings of one address as equal", () => {
  assert.equal(ton.sameTonAddress(RAW, FRIENDLY_BOUNCEABLE), true, "raw == friendly");
  assert.equal(ton.sameTonAddress(FRIENDLY_BOUNCEABLE, RAW), true, "friendly == raw");
  assert.equal(ton.sameTonAddress(RAW, RAW), true, "identity fast path");
  assert.equal(ton.sameTonAddress(RAW, OTHER_RAW), false, "different addresses differ");
  assert.equal(ton.sameTonAddress(null, RAW), false, "null recipient is refused");
  assert.equal(ton.sameTonAddress("", RAW), false, "empty recipient is refused");
  assert.equal(ton.sameTonAddress("garbage", RAW), false, "unparseable input is refused");
});

test("findTonTransfer matches the owner address in any spelling and reads both amount shapes", async (t) => {
  await db.resetDb();
  await config.ensureSeeded();
  await config.setSetting("ton_address", FRIENDLY_BOUNCEABLE); // owner pasted the friendly form
  await config.setSetting("ton_api_key", "test_key");
  const events = [
    {
      event_id: "ev_outgoing",
      actions: [{ type: "TonTransfer", TonTransfer: { recipient: { address: OTHER_RAW }, amount: { value: "999999999999" }, comment: "pay_ton_memo" } }],
    },
    {
      event_id: "ev_wrong_comment",
      actions: [{ type: "TonTransfer", TonTransfer: { recipient: { address: RAW }, amount: { value: "999999999999" }, comment: "other memo" } }],
    },
    {
      event_id: "ev_underpaid",
      actions: [{ type: "TonTransfer", TonTransfer: { recipient: { address: RAW }, amount: "100", comment: "pay_ton_memo" } }],
    },
    {
      event_id: "ev_ok_object_amount",
      actions: [{ type: "TonTransfer", TonTransfer: { recipient: { address: RAW }, amount: { value: "1500000000" }, comment: "pay_ton_memo extra" } }],
    },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json({ events }));
  const tx = await ton.findTonTransfer("pay_ton_memo", 1000000000n);
  assert.ok(tx, "an event matching address+memo+amount must be found");
  assert.equal(tx!.id, "ev_ok_object_amount");
  assert.equal(tx!.comment, "pay_ton_memo extra");
  assert.equal(tx!.nano, 1500000000n);
});

test("findTonTransfer refuses when no incoming transfer with the memo arrived", async (t) => {
  await db.resetDb();
  await config.ensureSeeded();
  await config.setSetting("ton_address", FRIENDLY_BOUNCEABLE);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      events: [
        { event_id: "ev_1", actions: [{ type: "TonTransfer", TonTransfer: { recipient: { address: RAW }, amount: { value: "5000000000" }, comment: "totally_different" } }] },
      ],
    })
  );
  const tx = await ton.findTonTransfer("pay_ton_memo", 1000000000n);
  assert.equal(tx, null);
});

test("verifyTonPayment only lets the paying user confirm their own payment", async () => {
  await db.resetDb();
  await db.mutate((d) => {
    d.users.push({ ...TEST_USER, credits: 0 });
    d.payments.push({
      id: "pay_owner_check",
      yookassaId: "",
      userId: TEST_USER.id,
      packageId: "pkg_test",
      amountRub: 100,
      credits: 3,
      status: "pending",
      createdAt: Date.now(),
      provider: "ton",
      externalId: "pay_owner_check",
    });
  });
  // Another user must not see/confirm somebody else's payment.
  const foreign = await ton.verifyTonPayment("pay_owner_check", "usr_someone_else");
  assert.equal(foreign.status, "unknown");
  assert.equal(foreign.granted, false);
  assert.equal((await db.db()).users[0].credits, 0);
  // No owner argument keeps the behaviour of the internal fulfillment path.
  const res = await ton.verifyTonPayment("pay_does_not_exist");
  assert.equal(res.status, "unknown");
});

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
