import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, PNG } from "./helpers";

let cleanup: () => void;
let connector: typeof import("../src/lib/generation/edit-compatible");
let diagnostics: typeof import("../src/lib/generation/diagnostics");
before(async () => {
  cleanup = isolateStorage();
  connector = await import("../src/lib/generation/edit-compatible");
  diagnostics = await import("../src/lib/generation/diagnostics");
});
after(() => cleanup());
const cfg = { provider: "genapi" as const, baseUrl: "https://api.gen-api.ru", model: "gpt-image-2", apiKey: "sk_private_test_key" };

test("GenAPI request sends the image, polls uncached with bounded calls, and returns a result", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${cfg.apiKey}`);
    if (init.method === "POST") {
      const data = JSON.parse(String(init.body));
      assert.ok(data.image_urls[0].startsWith("data:image/png;base64,"));
      assert.equal(data.num_images, 1);
      return Response.json({ request_id: 42, status: "starting" });
    }
    return Response.json({ status: "success", result: ["https://images.example.test/design.png"] });
  });
  const result = await connector.runCompatibleEdit(cfg, PNG, "image/png", "Keep the walls");
  assert.equal(result.outputUrl, "https://images.example.test/design.png");
  assert.deepEqual(calls, ["https://api.gen-api.ru/api/v1/networks/gpt-image-2", "https://api.gen-api.ru/api/v1/request/get/42"]);
});

test("401 is actionable and never echoes the API key", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: `invalid api key: ${cfg.apiKey}` }, { status: 401 }));
  await assert.rejects(connector.runCompatibleEdit(cfg, PNG, "image/png", "test"), (e: Error) => {
    assert.match(e.message, /GenAPI start failed \(401\): invalid api key/);
    assert.ok(!e.message.includes(cfg.apiKey));
    return true;
  });
});

test("probe uses only read-only /user; no secret, email or exact balance escapes", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    count++;
    assert.equal(url, "https://api.gen-api.ru/api/v1/user");
    assert.equal(init.method, undefined);
    return Response.json({ balance: 250, email: "private@example.test", api_key: cfg.apiKey });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.keyAccepted, true);
  assert.equal(result.hasBalance, true);
  assert.equal(count, 1);
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
  assert.ok(!JSON.stringify(result).includes("250"));
});

test("probe does not call HTML / a random 200 response a valid key", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Sign in</html>"));
  assert.equal((await diagnostics.probeCompatible(cfg)).keyAccepted, false);
});

test("probe rejects 401 and does not echo the upstream error body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: cfg.apiKey }, { status: 401 }));
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 401);
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
});
