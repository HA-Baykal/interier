import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import { isolateStorage, PNG } from "./helpers";

let cleanup: () => void;
let server: Server;
let origin = "";
let uploads: typeof import("../src/app/api/upload/service");
let diagnostics: typeof import("../src/lib/storage-diagnostics");
const files = new Map<string, Buffer>();
const writes: string[] = [];
let denied = false;
let authHeader = "";

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
      return;
    }
    authHeader = req.headers.authorization || "";
    res.setHeader("Content-Type", "application/json");
    if (denied) { res.writeHead(403); res.end(JSON.stringify({ error: { code: "forbidden" } })); return; }
    if (req.method === "PUT") {
      const pathname = url.searchParams.get("pathname")!;
      files.set(pathname, body);
      writes.push(pathname);
      const fileUrl = `${origin}/files/${encodeURIComponent(pathname)}`;
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
