import { after, before, beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateStorage, TEST_USER } from "./helpers";
import type { DbShape } from "../src/lib/types";

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let billing: typeof import("../src/lib/billing");
before(async () => { cleanup = isolateStorage(); store = await import("../src/lib/db"); billing = await import("../src/lib/billing"); });
beforeEach(async () => { await store.resetDb(); });
after(() => cleanup());
const empty = (): DbShape => ({ users: [], sessions: [], generations: [], styles: [], packages: [], rewards: [], referrals: [], settings: [] });

/** Upstash REST wire fixture. A competing instance can change the document just before CAS. */
function fakeRedis(t: TestContext, initial?: string) {
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test_redis_token";
  t.after(() => { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; });
  const values = new Map<string, string>();
  if (initial !== undefined) values.set("app:db", initial);
  const commands: unknown[][] = [];
  const mock = { values, commands, beforeCompare: null as null | (() => void), fail: false };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const command = JSON.parse(String(init.body)) as unknown[];
    commands.push(command);
    if (mock.fail) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const [op, key, value] = command as string[];
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal);
    let result: unknown;
    switch (op.toLowerCase()) {
      case "get": result = values.get(key) ?? null; break;
      case "set": values.set(key, value); result = "OK"; break;
      case "del": result = Number(values.delete(key)); break;
      case "eval": {
        assert.match(key, /redis.call\('GET'/);
        assert.match(key, /~= ARGV\[1\]/);
        const [, , , dbKey, expected, next] = command as string[];
        mock.beforeCompare?.();
        if ((values.get(dbKey) ?? "") !== expected) result = 0;
        else { values.set(dbKey, next); result = 1; }
        break;
      }
      default: throw new Error(`Unexpected Redis command: ${op}`);
    }
    return Response.json({ result });
  });
  return mock;
}

test("reading an empty Redis does not SET an empty database over another cold start", async (t) => {
  const remote = fakeRedis(t);
  assert.deepEqual(await store.db(), empty());
  assert.equal(remote.values.size, 0);
  assert.deepEqual(remote.commands.map((c) => c[0]), ["get"]);
});

test("Redis JSON object/string/double-encoded legacy data all preserve accounts", async (t) => {
  const data = { ...empty(), users: [{ ...TEST_USER }] };
  assert.deepEqual(store.coerceDatabase(data), data);
  assert.deepEqual(store.coerceDatabase(JSON.stringify(data)), data);
  const remote = fakeRedis(t, JSON.stringify(JSON.stringify(data)));
  assert.equal((await store.db()).users[0].email, TEST_USER.email);
  assert.equal(remote.values.size, 1);
});

test("CAS retries on a competing instance without losing its newly registered account", async (t) => {
  const data = { ...empty(), users: [{ ...TEST_USER }] };
  const remote = fakeRedis(t, JSON.stringify(data));
  remote.beforeCompare = () => {
    remote.beforeCompare = null;
    const competing = JSON.parse(remote.values.get("app:db")!) as DbShape;
    competing.users.push({ ...TEST_USER, id: "usr_other", email: "other@example.test" });
    remote.values.set("app:db", JSON.stringify(competing));
  };
  await store.mutate((d) => { d.users[0].credits++; });
  const result = await store.db();
  assert.equal(result.users.length, 2);
  assert.equal(result.users[0].credits, TEST_USER.credits + 1);
  assert.equal(remote.commands.filter((c) => c[0] === "eval").length, 2);
});

test("concurrent local mutations and one-time bonuses do not lose or double-spend credits", async () => {
  await store.mutate((d) => { d.users.push({ ...TEST_USER }); });
  const spent = await Promise.all(Array.from({ length: 12 }, () => billing.spendCredit(TEST_USER.id)));
  assert.equal(spent.filter(Boolean).length, TEST_USER.credits);
  const bonuses = await Promise.all(Array.from({ length: 12 }, () => billing.grantTelegramBonus(TEST_USER, "telegram", 1, "test")));
  assert.equal(bonuses.filter((b) => b.granted).length, 1);
  assert.equal((await store.db()).users[0].credits, 1);
});

test("unreadable Redis is backed up, never silently reset to an empty account list", async (t) => {
  const corrupt = '{"users":"broken","settings":[]}';
  const remote = fakeRedis(t, corrupt);
  await assert.rejects(store.db(), /повреждена/);
  assert.equal(remote.values.get("app:db"), corrupt);
  assert.ok([...remote.values.keys()].some((key) => key.startsWith("app:db:corrupt:")));
  assert.equal(store.coerceDatabase({ users: "broken", settings: [] }), null);
});

test("a Redis outage never falls back to a local file or wipes remote data", async (t) => {
  const original = JSON.stringify({ ...empty(), users: [{ ...TEST_USER }] });
  const remote = fakeRedis(t, original);
  remote.fail = true;
  await assert.rejects(store.db());
  assert.equal(store.storageMode(), "redis");
  assert.equal(remote.values.get("app:db"), original);
  assert.equal(fs.existsSync(process.env.DATABASE_PATH!), false);
});

test("memory mutations roll back on errors instead of mutating the live object", async (t) => {
  process.env.VERCEL = "1";
  t.after(() => { delete process.env.VERCEL; });
  await store.resetDb();
  await store.mutate((d) => { d.users.push({ ...TEST_USER }); });
  await assert.rejects(store.mutate((d) => { d.users.length = 0; throw new Error("rollback"); }), /rollback/);
  assert.equal((await store.db()).users.length, 1);
});

test("read/write Redis health check uses a separate TTL key and cleans it up", async (t) => {
  const original = JSON.stringify({ ...empty(), users: [{ ...TEST_USER }] });
  const remote = fakeRedis(t, original);
  assert.equal((await store.probeDatabase()).ok, true);
  assert.equal(remote.values.size, 1);
  assert.equal(remote.values.get("app:db"), original);
  const write = remote.commands.find((cmd) => cmd[0] === "set")!;
  assert.ok(String(write[1]).startsWith("app:db:health:"));
  assert.ok(write.includes("ex"));
});
