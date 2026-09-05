import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, PNG } from "./helpers";

let cleanup: () => void;
let errors: typeof import("../src/lib/errors");
before(async () => {
  cleanup = isolateStorage();
  errors = await import("../src/lib/errors");
});
after(() => cleanup());
const key = "sk_do_not_expose_error_fixture";
const context = "GenAPI start";

async function message(body: unknown, status = 422) {
  return (await errors.providerHttpError(Response.json(body, { status }), context, key)).message;
}

test("GenAPI's boolean error flag cannot mask field validation messages", async () => {
  const result = await message({ error: true, errors: { callback_url: ["Must be a valid URL"], "image_urls.0": ["Invalid image"] } });
  assert.match(result, /GenAPI start failed \(422\)/);
  assert.match(result, /callback_url: Must be a valid URL/);
  assert.match(result, /image_urls\.0: Invalid image/);
  assert.ok(!result.includes(": true"));
});

test("the official SDK's parameter/code error metadata is kept even without a text message", async () => {
  const result = await message({ error: true, parameter: "callback_url", code: "invalid_url" });
  assert.match(result, /Parameter: callback_url/);
  assert.match(result, /Code: invalid_url/);
  assert.ok(!result.includes("true"));
});

test("field-specific errors are not masked by a generic validation summary", async () => {
  const result = await message({ message: "Validation failed", errors: { image_size: ["Unsupported dimensions"] } });
  assert.match(result, /image_size: Unsupported dimensions/);
  assert.match(result, /Validation failed/);
});

test("messages/detail maps and arrays remain useful across provider response formats", async () => {
  for (const property of ["messages", "details", "detail"]) {
    const result = await message({ error: true, [property]: { image_urls: ["Image input invalid"] } });
    assert.match(result, /image_urls: Image input invalid/);
  }
  const result = await message({ error: true, messages: ["Invalid quality", "Invalid dimensions"] });
  assert.match(result, /Invalid quality/);
  assert.match(result, /Invalid dimensions/);
});

test("OpenAI-compatible nested message, code and parameter are preserved", async () => {
  const result = await message({ error: { message: "Unknown model", param: "model", code: "model_not_found", type: "invalid_request_error" } }, 400);
  assert.match(result, /model: Unknown model/);
  assert.match(result, /Code: model_not_found/);
});

test("FastAPI-style location/msg errors expose the invalid field but not the submitted input", async () => {
  const result = await message({ detail: [{ loc: ["body", "image_urls", 0], msg: "Invalid URL", input: "private-submitted-value", type: "url_parsing" }] });
  assert.match(result, /body\.image_urls\.0: Invalid URL/);
  assert.ok(!result.includes("private-submitted-value"));
  assert.ok(!result.includes("url_parsing"));
});

test("polling wrappers do not hide the nested error behind error: true", async () => {
  const result = errors.providerErrorDetail({
    status: "error", error: true,
    full_response: [{ error: { message: "Could not download source image", param: "image_urls" }, input: "private input", result: "not an error" }],
  });
  assert.match(result, /image_urls: Could not download source image/);
  assert.ok(!result.includes("private input"));
  assert.ok(!result.includes("not an error"));
});

test("nested data is inspected only for error fields, not account details or submitted payloads", async () => {
  const result = await message({ error: true, data: {
    errors: { quality: ["Invalid quality"] }, email: "private@example.test", balance: 12345.6789,
    headers: { authorization: `Bearer ${key}` }, input: { prompt: "private prompt" },
  } });
  assert.match(result, /quality: Invalid quality/);
  for (const secret of [key, "private@example.test", "12345.6789", "private prompt"]) assert.ok(!result.includes(secret));
});

test("keys, signed photo URLs and inline image bytes in error messages are redacted", async () => {
  const image = `data:image/png;base64,${PNG.toString("base64")}`;
  const result = await message({ error: true, errors: {
    image_urls: [`Cannot read https://photos.example.test/private.png?signature=private-signature or ${image}`],
    authorization: [`Bearer ${key}`],
  }, headers: { API_KEY: key } });
  assert.match(result, /image_urls/);
  for (const secret of [key, "private-signature", "photos.example.test", PNG.toString("base64")]) assert.ok(!result.includes(secret));
  assert.match(result, /\[URL\]/);
  assert.match(result, /\[image\]/);
});

test("boolean, null and numeric error flags alone produce a useful fallback, never literal true", async () => {
  for (const body of [true, false, null, { error: true }, { error: false }, { error: 1 }, { error: "true" }]) {
    const result = await message(body);
    assert.match(result, /GenAPI start failed \(422\): Провайдер отклонил параметры/);
    assert.ok(!result.endsWith(": true"));
  }
});

test("numeric error code zero is not lost to truthiness checks", async () => {
  assert.match(await message({ error: true, code: 0, parameter: "quality" }), /Code: 0/);
});

test("plain string errors and meaningful text responses still work", async () => {
  assert.match(await message({ error: "invalid api key" }, 401), /GenAPI start failed \(401\): invalid api key/);
  assert.match(await message("Quota exceeded", 429), /Quota exceeded/);
  const result = await errors.providerHttpError(new Response(`Token ${key} rejected`, { status: 401 }), context, key);
  assert.match(result.message, /rejected/);
  assert.ok(!result.message.includes(key));
});

test("HTML, truncated JSON and empty error bodies do not leak request dumps or crash", async () => {
  for (const body of [`<html>${key} private-data</html>`, `{"message":"${key}", "input":"private-data"`, `"private-data`, ""]) {
    const result = await errors.providerHttpError(new Response(body, { status: 422 }), context, key);
    assert.match(result.message, /GenAPI start failed \(422\)/);
    assert.ok(!result.message.includes(key));
    assert.ok(!result.message.includes("private-data"));
    assert.ok(!result.message.includes("<html>"));
    assert.ok(!result.message.endsWith(": "));
  }
});

test("oversized or deeply nested diagnostics stay bounded and readable", async () => {
  const result = await message({ errors: { prompt: ["Too long ".repeat(10000)] } });
  assert.ok(result.length <= 500);
  assert.match(result, /prompt: Too long/);
  const cycle: Record<string, unknown> = { error: "First error" };
  cycle.data = cycle;
  assert.equal(errors.providerErrorDetail(cycle), "First error");
});
