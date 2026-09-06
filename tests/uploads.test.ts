import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateStorage, PNG } from "./helpers";

let cleanup: () => void;
let uploads: typeof import("../src/app/api/upload/service");
before(async () => { cleanup = isolateStorage(); uploads = await import("../src/app/api/upload/service"); });
after(() => cleanup());

test("saved filenames and legacy bare IDs both resolve to the correct image", async () => {
  const saved = await uploads.saveUpload(PNG, "image/png");
  const full = uploads.findUpload(`${saved.id}.png`);
  assert.ok(full);
  assert.equal(uploads.findUpload(saved.id), full);
  assert.deepEqual(fs.readFileSync(full), PNG);
  assert.equal(uploads.findUpload("../../.env"), null);
  assert.equal(uploads.findUpload("up_missing.png"), null);
});

test("EROFS yields a self-contained preview rather than a 500 / an instance-local URL", async (t) => {
  t.mock.method(fs, "mkdirSync", () => { throw Object.assign(new Error("Read-only filesystem"), { code: "EROFS" }); });
  const saved = await uploads.saveUpload(PNG, "image/png");
  assert.equal(saved.url, `data:image/png;base64,${PNG.toString("base64")}`);
  assert.equal(uploads.uploadStorageMode(), "inline");
});

test("invalid images cannot be stored as executable content", async () => {
  await assert.rejects(uploads.saveUpload(Buffer.from("<script>alert(1)</script>"), "image/png"), /Unsupported image/);
  await assert.rejects(uploads.saveUpload(PNG, "image/svg+xml"), /Unsupported image/);
});
