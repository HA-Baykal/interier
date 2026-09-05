import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import { isolateStorage, PNG, TEST_USER } from "./helpers";
import { NextRequest } from "next/server";

let cleanup: () => void;
let server: Server;
let origin = "";
let uploads: typeof import("../src/app/api/upload/service");
let diagnostics: typeof import("../src/lib/storage-diagnostics");
const files = new Map<string, Buffer>();
const writes: string[] = [];
let denied = false;
let authHeader = "";
let storeHeader = "";
const authRequests: { method: string; token: string; storeId: string }[] = [];
let afterImageRead: (() => void) | null = null;
let publicOrigin = "";

/** Synthetic, non-secret JWT accepted only by our local SDK wire fixture. */
function oidcToken(label: string) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: `test-${label}` })).toString("base64url"),
    "test-signature",
  ].join(".");
}

function useOidc() {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.BLOB_STORE_ID = ' "store_linked"\r ';
}

before(async () => {
  cleanup = isolateStorage();
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (req.method === "GET" && url.pathname.startsWith("/files/")) {
      const data = files.get(decodeURIComponent(url.pathname.slice(7)));
      res.writeHead(data ? 200 : 404, { "Content-Type": "image/png" });
      res.end(data);
      afterImageRead?.();
      return;
    }
    authHeader = req.headers.authorization || "";
    storeHeader = String(req.headers["x-vercel-blob-store-id"] || "");
    authRequests.push({ method: req.method || "", token: authHeader, storeId: storeHeader });
    res.setHeader("Content-Type", "application/json");
    if (denied) { res.writeHead(403); res.end(JSON.stringify({ error: { code: "forbidden" } })); return; }
    if (req.method === "PUT") {
      const pathname = url.searchParams.get("pathname")!;
      files.set(pathname, body);
      writes.push(pathname);
      const fileUrl = `${publicOrigin || origin}/files/${encodeURIComponent(pathname)}`;
      res.end(JSON.stringify({ url: fileUrl, downloadUrl: fileUrl, pathname, contentType: "image/png" }));
    } else if (url.pathname === "/delete") {
      const data = JSON.parse(body.toString());
      for (const fileUrl of data.urls) files.delete(decodeURIComponent(new URL(fileUrl).pathname.slice(7)));
      res.end("{}");
    } else { res.writeHead(404); res.end("{}"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.VERCEL_BLOB_API_URL = origin; // SDK wire test: never contacts a real Blob store.
  uploads = await import("../src/app/api/upload/service");
  diagnostics = await import("../src/lib/storage-diagnostics");
});
beforeEach(() => {
  denied = false;
  publicOrigin = "";
  afterImageRead = null;
  authRequests.length = 0;
  for (const name of ["VERCEL", "VERCEL_ENV", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID"]) delete process.env[name];
  files.clear();
  writes.length = 0;
  process.env.BLOB_READ_WRITE_TOKEN = ' "vercel_blob_rw_teststore_testsecret"\r\n ';
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); cleanup(); });

test("Blob SDK stores the actual bytes using the cleaned token, without local writes", async () => {
  const original = await uploads.saveUpload(PNG, "image/png");
  const result = await uploads.saveUpload(PNG, "image/png");
  assert.equal(authHeader, "Bearer vercel_blob_rw_teststore_testsecret");
  assert.equal(writes.length, 2);
  assert.notEqual(original.url, result.url);
  assert.deepEqual(Buffer.from(await (await fetch(original.url)).arrayBuffer()), PNG);
  assert.deepEqual(Buffer.from(await (await fetch(result.url)).arrayBuffer()), PNG);
  assert.equal(fs.existsSync("data/uploads"), false);
});

test("a configured-but-denied Blob fails loudly, never silently falls back to ephemeral storage", async () => {
  denied = true;
  await assert.rejects(uploads.saveUpload(PNG, "image/png"), /access|permission/i);
  assert.equal(files.size, 0);
  assert.equal(fs.existsSync("data/uploads"), false);
});

test("Blob health check writes, reads and deletes only its own temporary photo", async () => {
  files.set("uploads/a-real-users-photo.png", PNG);
  const result = await diagnostics.probeBlob();
  assert.equal(result.ok, true);
  assert.equal(result.cleanup, true);
  assert.equal(files.size, 1);
  assert.ok(files.has("uploads/a-real-users-photo.png"));
  assert.ok(writes[0].startsWith("uploads/_health/"));
});


test("OIDC stores original and result images without BLOB_READ_WRITE_TOKEN and follows token rotation", async () => {
  useOidc();
  const firstToken = oidcToken("first");
  process.env.VERCEL_OIDC_TOKEN = firstToken;
  const original = await uploads.saveUpload(PNG, "image/png");
  assert.equal(authHeader, `Bearer ${firstToken}`);
  assert.equal(storeHeader, "linked");
  const nextToken = oidcToken("rotated");
  process.env.VERCEL_OIDC_TOKEN = nextToken;
  const result = await uploads.saveUpload(PNG, "image/png");
  assert.equal(authHeader, `Bearer ${nextToken}`);
  assert.equal(uploads.uploadStorageMode(), "blob");
  assert.equal(diagnostics.storageStatus().blobAuthentication, "oidc");
  assert.ok(writes.every((key) => key.startsWith("uploads/preview/")));
  assert.deepEqual(Buffer.from(await (await fetch(original.url)).arrayBuffer()), PNG);
  assert.deepEqual(Buffer.from(await (await fetch(result.url)).arrayBuffer()), PNG);
  assert.equal(fs.existsSync("data/uploads"), false);
});

test("OIDC health check also works with request-context credentials, including rotation before cleanup", async (t) => {
  useOidc();
  const context = Symbol.for("@vercel/request-context");
  const original = Object.getOwnPropertyDescriptor(globalThis, context);
  let currentToken = oidcToken("context-first");
  const firstToken = currentToken;
  const nextToken = oidcToken("context-rotated");
  Object.defineProperty(globalThis, context, {
    configurable: true,
    value: { get: () => ({ headers: { "x-vercel-oidc-token": currentToken } }) },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, context, original);
    else Reflect.deleteProperty(globalThis, context);
  });
  afterImageRead = () => { currentToken = nextToken; };
  files.set("uploads/a-real-users-photo.png", PNG);
  const result = await diagnostics.probeBlob();
  assert.equal(result.ok, true);
  assert.equal(result.cleanup, true);
  assert.equal(process.env.VERCEL_OIDC_TOKEN, undefined);
  assert.equal(authRequests[0].token, `Bearer ${firstToken}`);
  assert.equal(authRequests.at(-1)?.token, `Bearer ${nextToken}`);
  assert.ok(authRequests.every((req) => req.storeId === "linked"));
  assert.equal(files.size, 1);
  assert.ok(files.has("uploads/a-real-users-photo.png"));
  assert.ok(!JSON.stringify(result).includes(firstToken));
  assert.ok(!JSON.stringify(result).includes(nextToken));
});

test("a denied OIDC store never falls back to local photos", async () => {
  useOidc();
  process.env.VERCEL_OIDC_TOKEN = oidcToken("denied");
  denied = true;
  await assert.rejects(uploads.saveUpload(PNG, "image/png"), /access|permission/i);
  const probe = await diagnostics.probeBlob();
  assert.equal(probe.ok, false);
  assert.equal(files.size, 0);
  assert.equal(fs.existsSync("data/uploads"), false);
});

test("a store ID without usable runtime credentials fails rather than reporting a successful upload", async () => {
  useOidc();
  await assert.rejects(uploads.saveUpload(PNG, "image/png"), /No blob credentials found/);
  assert.equal(files.size, 0);
  assert.equal(fs.existsSync("data/uploads"), false);
});

test("runtime JWTs echoed in an error are redacted even when absent from the environment", async () => {
  const { safeErrorMessage } = await import("../src/lib/errors");
  const token = oidcToken("request-only");
  const message = safeErrorMessage(new Error(`Invalid credential: ${token}`));
  assert.ok(!message.includes(token));
  assert.match(message, /redacted/);
});


async function prepareGeneration(quality?: string) {
  const store = await import("../src/lib/db");
  const seed = await import("../src/lib/config");
  await store.resetDb();
  await seed.ensureSeeded();
  await seed.setSetting("compatible_api_key", "sk_blob_pipeline_fixture");
  await seed.setSetting("test_unlimited", "0");
  await store.mutate((d) => {
    d.users.push({ ...TEST_USER });
    d.sessions.push({ token: "image-pipeline-session", userId: TEST_USER.id, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  });
  const form = new FormData();
  form.set("file", new File([PNG], "room.png", { type: "image/png" }));
  form.set("styleId", "style_modern");
  form.set("scope", "single");
  if (quality !== undefined) form.set("quality", quality);
  return { store, request: new NextRequest("https://protected-preview.example.test/api/generate", {
    method: "POST", headers: { "x-session-token": "image-pipeline-session" }, body: form,
  }) };
}

test("generation sends the selected medium quality and saved OIDC photo, then stores its result with refreshed credentials", async (t) => {
  // A local file DB plus the real Blob SDK wire fixture; no real cloud credentials.
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_STORE_ID = "store_linked";
  const firstToken = oidcToken("before-generation");
  const nextToken = oidcToken("after-generation");
  process.env.VERCEL_OIDC_TOKEN = firstToken;
  publicOrigin = "https://photos.example.test";
  const { store, request } = await prepareGeneration("medium");
  const { POST } = await import("../src/app/api/generate/route");
  let starts = 0;
  let sentPhoto = "";
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      starts++;
      assert.equal(url, "https://api.gen-api.ru/api/v1/networks/gpt-image-2");
      assert.equal(writes.length, 1, "the original is uploaded once, before the paid start");
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.quality, "medium");
      assert.equal(payload.image_size, "1024x1024");
      assert.equal(payload.num_images, 1);
      sentPhoto = payload.image_urls[0];
      assert.equal(sentPhoto, `${publicOrigin}/files/${encodeURIComponent(writes[0])}`);
      assert.equal(Object.hasOwn(payload, "callback_url"), false);
      assert.ok(!String(init.body).includes(PNG.toString("base64")));
      assert.ok(!String(init.body).includes("protected-preview.example.test"));
      process.env.VERCEL_OIDC_TOKEN = nextToken;
      return Response.json({ request_id: 101 });
    }
    if (url === "https://api.gen-api.ru/api/v1/request/get/101") {
      return Response.json({ status: "success", result: ["https://result.example.test/generated.png"] });
    }
    assert.equal(url, "https://result.example.test/generated.png");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return new Response(new Uint8Array(PNG), { headers: { "Content-Type": "image/png" } });
  });
  const response = await POST(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.isDemo, false);
  assert.equal(body.generations[0].status, "done");
  assert.equal(body.generations[0].originalUrl, sentPhoto);
  assert.equal(body.generations[0].quality, "medium");
  assert.ok(body.generations[0].resultUrl.startsWith(publicOrigin));
  assert.notEqual(body.generations[0].resultUrl, sentPhoto);
  assert.equal(starts, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(files.get(writes[0]), PNG);
  assert.deepEqual(files.get(writes[1]), PNG);
  assert.equal(authRequests[0].token, `Bearer ${firstToken}`);
  assert.equal(authRequests.at(-1)?.token, `Bearer ${nextToken}`);
  const saved = (await store.db()).generations[0];
  assert.equal(saved.originalUrl, sentPhoto);
  assert.equal(saved.resultUrl, body.generations[0].resultUrl);
  assert.equal(saved.status, "done");
  assert.equal(saved.quality, "medium");
});

test("a failed original Blob write cannot issue a paid GenAPI request or consume the trial", async (t) => {
  const { store, request } = await prepareGeneration();
  const { POST } = await import("../src/app/api/generate/route");
  denied = true;
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { providerCalls++; throw new Error("Must not contact GenAPI"); });
  const response = await POST(request);
  assert.equal(response.status, 500);
  assert.equal(providerCalls, 0);
  const d = await store.db();
  assert.equal(d.generations.length, 0);
  assert.equal(d.users.find((user) => user.id === TEST_USER.id)?.trialUsed, false);
});
