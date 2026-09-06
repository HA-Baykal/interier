import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage } from "./helpers";

let cleanup: () => void;
let security: typeof import("../src/lib/security-store");
before(async () => { cleanup = isolateStorage(); security = await import("../src/lib/security-store"); });
beforeEach(() => security.resetSecurityMemoryForTests());
after(() => cleanup());

test("small auth documents expire and counters enforce a bounded window in local tests", async t => {
  const now = Date.now();
  let clock = now;
  t.mock.method(Date, "now", () => clock);
  await security.mutateSecurityDocument<{ value: number }, void>("test", () => ({ value: { value: 1 }, expiresAt: now + 1000, result: undefined }));
  assert.deepEqual(await security.getSecurityDocument("test"), { value: 1 });
  await security.enforceRateLimit("scope", "bucket", 1, 1000);
  await assert.rejects(security.enforceRateLimit("scope", "bucket", 1, 1000), /Слишком много/);
  clock = now + 1001;
  assert.equal(await security.getSecurityDocument("test"), null);
  await security.enforceRateLimit("scope", "bucket", 1, 1000);
});

test("Vercel never falls back to process-local auth storage without Redis", async t => {
  process.env.VERCEL = "1";
  t.after(() => { delete process.env.VERCEL; });
  await assert.rejects(security.getSecurityDocument("test"), /Постоянная база/);
  await assert.rejects(security.enforceRateLimit("scope", "bucket", 1, 1000), /Постоянная база/);
});

test("Redis auth records are separate TTL keys with CAS and contain no raw IP in rate keys", async t => {
  process.env.KV_REST_API_URL = "https://auth-redis.example.test";
  process.env.KV_REST_API_TOKEN = "fake-auth-redis-token";
  t.after(() => { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; });
  const records = new Map<string, string>();
  const counts = new Map<string, number>();
  const keys: string[] = [];
  t.mock.method(globalThis, "fetch", async (_: unknown, init: RequestInit) => {
    const args = JSON.parse(String(init.body));
    assert.equal(init.cache, "no-store"); assert.ok(init.signal);
    let result: unknown;
    if (args[0] === "get") { keys.push(args[1]); result = records.get(args[1]) ?? null; }
    else if (args[0] === "eval") {
      keys.push(args[3]);
      if (String(args[1]).includes("'INCR'")) {
        assert.match(args[1], /PEXPIRE/); result = (counts.get(args[3]) || 0) + 1; counts.set(args[3], Number(result));
      } else {
        assert.match(args[1], /'PX'/);
        assert.ok(Number(args[6]) > 0 && Number(args[6]) <= 15 * 60_000);
        if ((records.get(args[3]) ?? "") === args[4]) { records.set(args[3], args[5]); result = 1; } else result = 0;
      }
    } else throw new Error("Unexpected command");
    return Response.json({ result });
  });
  await security.mutateSecurityDocument<{ count: number }, void>("ticket:test", () => ({ value: { count: 1 }, expiresAt: Date.now() + 60000, result: undefined }));
  await security.mutateSecurityDocument<{ count: number }, void>("ticket:test", old => ({ value: { count: old!.count + 1 }, expiresAt: Date.now() + 60000, result: undefined }));
  assert.deepEqual(await security.getSecurityDocument("ticket:test"), { count: 2 });
  await security.enforceRateLimit("start", "192.0.2.10", 1, 60000);
  await assert.rejects(security.enforceRateLimit("start", "192.0.2.10", 1, 60000), /Слишком много/);
  assert.ok(keys.every(key => key.startsWith("app:db:security:") && key !== "app:db"));
  assert.ok(!keys.some(key => key.includes("192.0.2.10")));
});
