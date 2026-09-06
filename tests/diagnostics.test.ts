import { after, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage } from "./helpers";

let cleanup: () => void;
let diagnostics: typeof import("../src/lib/generation/diagnostics");
before(async () => {
  cleanup = isolateStorage();
  diagnostics = await import("../src/lib/generation/diagnostics");
});
after(() => cleanup());
const cfg = { provider: "genapi" as const, baseUrl: "https://api.gen-api.ru", model: "gpt-image-2", apiKey: "sk_private_diagnostic_key" };

function shortBudget(t: TestContext) {
  const controller = new AbortController();
  // A referenced test-only timer: AbortSignal.timeout normally uses unref().
  const timer = setTimeout(() => controller.abort(new DOMException("Test deadline", "TimeoutError")), 25);
  t.after(() => clearTimeout(timer));
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    assert.equal(ms, 30_000);
    return controller.signal;
  });
  return controller.signal;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("the probe gives slow responses 30 seconds, not the old 10-second cutoff", async (t) => {
  let budget = 0;
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budget = ms;
    return new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async (_: string, init: RequestInit) => {
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${cfg.apiKey}`);
    return Response.json({ balance: 10 });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(budget, 30_000);
  assert.equal(result.timeoutMs, budget);
  assert.equal(result.code, "accepted");
  assert.equal(result.attempts, 1);
  assert.ok(Number.isFinite(result.elapsedMs));
});

test("a stalled connection is unverified, not a rejected key; the overall deadline is bounded", async (t) => {
  const signal = shortBudget(t);
  t.mock.method(globalThis, "fetch", async (_: string, init: RequestInit) => {
    assert.equal(init.signal, signal);
    return waitForAbort(signal);
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.attempts, 1);
  assert.equal(result.httpStatus, undefined);
  assert.match(result.message, /Ключ не проверен/);
});

test("a body that stalls after HTTP 200 remains a timeout, not invalid JSON or a rejected key", async (t) => {
  const signal = shortBudget(t);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"balance":'));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  }), { headers: { "Content-Type": "application/json" } }));
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.code, "timeout");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.attempts, 1);
});

test("a transient connection reset retries only GET once using the SAME total budget", async (t) => {
  const signals: (AbortSignal | null | undefined)[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.gen-api.ru/api/v1/user");
    assert.equal(init.method, "GET");
    signals.push(init.signal);
    if (signals.length === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    return Response.json({ balance: "1.25", email: "private@example.test" });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.keyAccepted, true);
  assert.equal(result.hasBalance, true);
  assert.equal(result.attempts, 2);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
});

test("a timeout while waiting to retry cannot start a fresh unbounded attempt", async (t) => {
  shortBudget(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.code, "timeout");
  assert.equal(result.networkCode, "ECONNRESET");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test("nested connect timeout codes are safe to report, but error messages and account data are not", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError(cfg.apiKey, { cause: new AggregateError([
      Object.assign(new Error(`private@example.test ${cfg.apiKey}`), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    ]) });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.code, "timeout");
  assert.equal(result.networkCode, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
});

test("arbitrary exception codes are not returned as diagnostic data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError(cfg.apiKey, { cause: { code: cfg.apiKey, message: "private@example.test" } });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.code, "network_error");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.networkCode, undefined);
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
});

test("TLS verification errors are reported without retrying or disabling verification", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.keyAccepted, null);
  assert.equal(result.networkCode, "CERT_HAS_EXPIRED");
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

for (const status of [401, 403]) {
  test(`HTTP ${status} really rejects access, is not retried, and its untrusted body is cancelled`, async (t) => {
    let calls = 0;
    let cancelled = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status });
    });
    const result = await diagnostics.probeCompatible(cfg);
    assert.equal(result.code, "access_denied");
    assert.equal(result.keyAccepted, false);
    assert.equal(result.httpStatus, status);
    assert.equal(result.attempts, 1);
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
  });
}

test("503 may be retried once, but its body is never read or disclosed", async (t) => {
  let calls = 0;
  let cancelled = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 });
    return Response.json({ balance: 0 });
  });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.keyAccepted, true);
  assert.equal(result.hasBalance, false);
  assert.equal(result.attempts, 2);
  assert.equal(cancelled, 1);
});

test("persistent HTTP 5xx is capped at two attempts and never calls the key invalid", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ secret: cfg.apiKey }, { status: 502 }); });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.code, "http_error");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.httpStatus, 502);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(result).includes(cfg.apiKey));
});

test("rate limiting is not an invalid key and is not automatically retried", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ secret: cfg.apiKey }, { status: 429 }); });
  const result = await diagnostics.probeCompatible(cfg);
  assert.equal(result.code, "http_error");
  assert.equal(result.keyAccepted, null);
  assert.equal(result.httpStatus, 429);
  assert.equal(calls, 1);
});

for (const balance of [null, "", false, [], {}]) {
  test(`HTTP 200 with malformed balance ${JSON.stringify(balance)} is not proof of a valid key`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ balance }));
    const result = await diagnostics.probeCompatible(cfg);
    assert.equal(result.code, "unexpected_response");
    assert.equal(result.keyAccepted, null);
    assert.equal(result.hasBalance, undefined);
    assert.equal(result.attempts, 1);
  });
}

test("missing or malformed credentials/configuration never cause an outbound call", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not be called"); });
  const missing = await diagnostics.probeCompatible({ ...cfg, apiKey: "" });
  assert.equal(missing.code, "key_missing");
  assert.equal(missing.keyAccepted, null);
  assert.equal(missing.attempts, 0);
  const invalid = await diagnostics.probeCompatible({ ...cfg, baseUrl: "http://unsafe.example.test" });
  assert.equal(invalid.code, "configuration_error");
  assert.equal(invalid.keyAccepted, null);
  assert.equal(invalid.attempts, 0);
});

test("OpenAI-compatible providers still use the read-only /models endpoint", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.example.test/v1/models");
    assert.equal(init.method, "GET");
    return Response.json({ data: [{ id: "example-model" }] });
  });
  const result = await diagnostics.probeCompatible({ ...cfg, provider: "openai-compatible", baseUrl: "https://api.example.test/v1" });
  assert.equal(result.code, "accepted");
  assert.equal(result.keyAccepted, true);
  assert.equal(result.hasBalance, undefined);
});
