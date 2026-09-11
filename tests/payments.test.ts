import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let config: typeof import("../src/lib/config");
let paymentsCreateRoute: typeof import("../src/app/api/payments/create/route");
let yookassaWebhookRoute: typeof import("../src/app/api/payments/yookassa/webhook/route");

before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db");
  config = await import("../src/lib/config");
  paymentsCreateRoute = await import("../src/app/api/payments/create/route");
  yookassaWebhookRoute = await import("../src/app/api/payments/yookassa/webhook/route");
});

beforeEach(async () => {
  await db.resetDb();
  await config.ensureSeeded();
  await db.mutate((d) => {
    d.users.push({ ...TEST_USER, id: "usr_buyer", email: "buyer@test.ru", credits: 2 });
    d.sessions.push({
      token: "buyer-session-token",
      userId: "usr_buyer",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
  });
});

after(() => cleanup());

function userReq(path: string, body?: any) {
  return new NextRequest(`https://app.example.test${path}`, {
    method: "POST",
    headers: {
      "x-session-token": "buyer-session-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
}

test("unauthenticated payment creation is rejected with 401", async () => {
  const anonReq = new NextRequest("https://app.example.test/api/payments/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packageId: "pack_start" }),
  });
  const res = await paymentsCreateRoute.POST(anonReq);
  assert.equal(res.status, 401);
});

test("test mode payment creation immediately credits user account", async () => {
  const allPackages = (await db.db()).packages;
  const target = allPackages[0];
  assert.ok(target);

  const initialCredits = (await db.db()).users.find((u) => u.id === "usr_buyer")?.credits ?? 0;

  const res = await paymentsCreateRoute.POST(userReq("/api/payments/create", { packageId: target.id }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.isTest, true);
  assert.equal(data.creditsAdded, target.credits);

  const updatedUser = (await db.db()).users.find((u) => u.id === "usr_buyer");
  assert.equal(updatedUser?.credits, initialCredits + target.credits);
});

test("yookassa webhook successfully credits user account on payment.succeeded", async () => {
  const allPackages = (await db.db()).packages;
  const target = allPackages[1]; // e.g. standard package

  const webhookPayload = {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: "2d8f99c0-000f-5000-8000-1845d4975d4e",
      status: "succeeded",
      paid: true,
      amount: { value: String(target.price), currency: "RUB" },
      metadata: {
        userId: "usr_buyer",
        packageId: target.id,
        paymentId: "pay_test_hook",
      },
    },
  };

  const req = new NextRequest("https://app.example.test/api/payments/yookassa/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload),
  });

  const res = await yookassaWebhookRoute.POST(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);

  const updatedUser = (await db.db()).users.find((u) => u.id === "usr_buyer");
  // 2 initial credits + target.credits
  assert.equal(updatedUser?.credits, 2 + target.credits);
});
