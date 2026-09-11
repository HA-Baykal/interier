import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let db: typeof import("../src/lib/db");
let config: typeof import("../src/lib/config");
let packagesRoute: typeof import("../src/app/api/admin/packages/route");
let packageIdRoute: typeof import("../src/app/api/admin/packages/[id]/route");

before(async () => {
  cleanup = isolateStorage();
  db = await import("../src/lib/db");
  config = await import("../src/lib/config");
  packagesRoute = await import("../src/app/api/admin/packages/route");
  packageIdRoute = await import("../src/app/api/admin/packages/[id]/route");
});

beforeEach(async () => {
  await db.resetDb();
  await config.ensureSeeded();
  await db.mutate((d) => {
    d.users.push({ ...TEST_USER, isAdmin: true });
    d.sessions.push({
      token: "admin-session-token",
      userId: TEST_USER.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
    d.users.push({ ...TEST_USER, id: "usr_regular", email: "user@test.ru", isAdmin: false });
    d.sessions.push({
      token: "regular-session-token",
      userId: "usr_regular",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });
  });
});

after(() => cleanup());

function adminReq(path: string, method = "GET", body?: any) {
  return new NextRequest(`https://app.example.test${path}`, {
    method,
    headers: {
      "x-session-token": "admin-session-token",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function userReq(path: string, method = "GET", body?: any) {
  return new NextRequest(`https://app.example.test${path}`, {
    method,
    headers: {
      "x-session-token": "regular-session-token",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("packages list requires admin authentication", async () => {
  const denied = await packagesRoute.GET(userReq("/api/admin/packages"));
  assert.equal(denied.status, 403);

  const allowed = await packagesRoute.GET(adminReq("/api/admin/packages"));
  assert.equal(allowed.status, 200);
  const data = await allowed.json();
  assert.ok(Array.isArray(data.packages));
  assert.equal(data.packages.length >= 3, true);
});

test("admin can manually edit package prices, credits, and active state", async () => {
  const all = (await db.db()).packages;
  const target = all[0];
  assert.ok(target);

  // Update price from 490 to 790, and credits from 5 to 7
  const res = await packageIdRoute.PATCH(
    adminReq(`/api/admin/packages/${target.id}`, "PATCH", {
      price: 790,
      credits: 7,
      active: true,
      badgeRu: "Хит продаж",
      badgeEn: "Hot deal",
    }),
    { params: { id: target.id } }
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.package.price, 790);
  assert.equal(json.package.credits, 7);
  assert.equal(json.package.badge.ru, "Хит продаж");

  const updatedInDb = (await db.db()).packages.find((p) => p.id === target.id);
  assert.equal(updatedInDb?.price, 790);
  assert.equal(updatedInDb?.credits, 7);
  assert.equal(updatedInDb?.badge?.ru, "Хит продаж");
});

test("admin can create a new custom package and delete it", async () => {
  const createRes = await packagesRoute.POST(
    adminReq("/api/admin/packages", "POST", {
      slug: "mega",
      nameRu: "Мега",
      nameEn: "Mega",
      descRu: "100 генераций для дизайнеров",
      descEn: "100 generations for designers",
      credits: 100,
      price: 5990,
      badgeRu: "VIP",
      badgeEn: "VIP",
      active: true,
    })
  );

  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(created.ok, true);
  assert.equal(created.package.slug, "mega");
  assert.equal(created.package.price, 5990);
  assert.equal(created.package.credits, 100);

  const newId = created.package.id;
  const inDb = (await db.db()).packages.find((p) => p.id === newId);
  assert.ok(inDb);
  assert.equal(inDb.price, 5990);

  // Now delete the package
  const delRes = await packageIdRoute.DELETE(
    adminReq(`/api/admin/packages/${newId}`, "DELETE"),
    { params: { id: newId } }
  );
  assert.equal(delRes.status, 200);
  const afterDel = (await db.db()).packages.find((p) => p.id === newId);
  assert.equal(afterDel, undefined);
});

test("price cannot be negative and invalid inputs are rejected", async () => {
  const all = (await db.db()).packages;
  const target = all[0];

  const badRes = await packageIdRoute.PATCH(
    adminReq(`/api/admin/packages/${target.id}`, "PATCH", {
      price: -500,
    }),
    { params: { id: target.id } }
  );
  assert.equal(badRes.status, 400);

  const notFound = await packageIdRoute.PATCH(
    adminReq("/api/admin/packages/pack_nonexistent", "PATCH", {
      price: 1000,
    }),
    { params: { id: "pack_nonexistent" } }
  );
  assert.equal(notFound.status, 404);
});
