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
      assert.equal(data.quality, "high");
      assert.equal(data.image_size, "1024x1024");
      assert.equal(data.output_format, "png");
      assert.equal(Object.hasOwn(data, "callback_url"), false);
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
    assert.equal(init.method, "GET");
    return Response.json({ balance: 12345.6789, email: "private@example.test", api_key: cfg.apiKey });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.keyAccepted, true);
  assert.equal(result.hasBalance, true);
  assert.equal(count, 1);
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
  assert.ok(!JSON.stringify(result).includes("12345.6789"));
});

test("probe does not call HTML / a random 200 response a valid key", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Sign in</html>"));
  assert.equal((await diagnostics.probeCompatible(cfg)).keyAccepted, null);
});

test("probe rejects 401 and does not echo the upstream error body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: cfg.apiKey }, { status: 401 }));
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 401);
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
});

test("a timed-out paid generation start is never automatically repeated", async (t) => {
  let starts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.gen-api.ru/api/v1/networks/gpt-image-2");
    assert.equal(init.method, "POST");
    starts++;
    throw new DOMException("The operation timed out", "TimeoutError");
  });
  await assert.rejects(connector.runCompatibleEdit(cfg, PNG, "image/png", "test"), /timed out/);
  assert.equal(starts, 1);
});


test("GenAPI sends a saved public photo URL without a null callback or inline image and never retries 422", async (t) => {
  const original = "https://photos.example.test/uploads/room.png";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.gen-api.ru/api/v1/networks/gpt-image-2");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(String(init.body)), {
      prompt: "Keep the walls", image_urls: [original], quality: "high",
      image_size: "1024x1024", num_images: 1, output_format: "png",
    });
    assert.ok(!String(init.body).includes("data:image"));
    // A synthetic validation response: useful fields must survive error: true.
    return Response.json({ error: true, parameter: "image_urls", code: "invalid_image" }, { status: 422 });
  });
  await assert.rejects(connector.runCompatibleEdit(cfg, PNG, "image/png", "Keep the walls", original), (e: Error) => {
    assert.match(e.message, /GenAPI start failed \(422\)/);
    assert.match(e.message, /image_urls/);
    assert.match(e.message, /invalid_image/);
    assert.ok(!e.message.includes(": true"));
    return true;
  });
  assert.equal(calls, 1);
});

test("invalid external photo URLs fail before a paid request rather than leaking embedded credentials", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not be reached"); });
  for (const original of ["http://photos.example.test/a.png", "https://name:secret@photos.example.test/a.png", "https://photos.example.test/a.png#fragment"]) {
    await assert.rejects(connector.runCompatibleEdit(cfg, PNG, "image/png", "Keep the walls", original), /public HTTPS/);
  }
  assert.equal(calls, 0);
});

test("an HTTP-200 logical start failure keeps provider error metadata without polling or repeating the start", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: true, parameter: "image_urls", code: "invalid_file" });
  });
  await assert.rejects(connector.runCompatibleEdit(cfg, PNG, "image/png", "Keep the walls"), /image_urls.*invalid_file/);
  assert.equal(calls, 1);
});

test("a polling error flag cannot hide the actual nested failure or disclose a token", async (t) => {
  let starts = 0;
  t.mock.method(globalThis, "fetch", async (_: string, init: RequestInit) => {
    if (init.method === "POST") { starts++; return Response.json({ request_id: 100 }); }
    return Response.json({ status: "error", error: true, full_response: [{ error: { message: `Image download rejected for ${cfg.apiKey}`, param: "image_urls" }, input: "not an error" }] });
  });
  await assert.rejects(connector.runCompatibleEdit(cfg, PNG, "image/png", "Keep the walls"), (e: Error) => {
    assert.match(e.message, /image_urls.*Image download rejected/);
    assert.ok(!e.message.includes(cfg.apiKey));
    assert.ok(!e.message.includes("not an error"));
    return true;
  });
  assert.equal(starts, 1);
});

test("OpenAI-compatible image edits still upload a multipart file, not a GenAPI URL payload", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.example.test/v1/images/edits");
    assert.equal(init.method, "POST");
    assert.ok(init.body instanceof FormData);
    assert.equal(new Headers(init.headers).get("content-type"), null);
    const image = init.body.get("image");
    assert.ok(image instanceof Blob);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
    assert.equal(init.body.get("prompt"), "Keep the walls");
    assert.equal(init.body.get("n"), "1");
    assert.equal(init.body.has("image_urls"), false);
    return Response.json({ data: [{ url: "https://result.example.test/output.png" }] });
  });
  const result = await connector.runCompatibleEdit({ ...cfg, provider: "openai-compatible", baseUrl: "https://api.example.test/v1" }, PNG, "image/png", "Keep the walls", "https://photos.example.test/room.png");
  assert.equal(result.outputUrl, "https://result.example.test/output.png");
});
