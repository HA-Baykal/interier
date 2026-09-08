import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, PNG } from "./helpers";

/**
 * The bot must hand over the design *together with* its details, and a tap on a
 * detail must lead to a shop — never to a paid regeneration. Both were real
 * bugs: an empty list looked like a broken product, and one accidental tap on
 * «Диван» started an edit generation.
 */

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let engine: typeof import("../src/lib/bots/engine");

before(async () => {
  cleanup = isolateStorage();
  store = await import("../src/lib/db");
  seed = await import("../src/lib/config");
  engine = await import("../src/lib/bots/engine");
});
beforeEach(async () => {
  await store.resetDb();
  await seed.ensureSeeded();
});
after(() => cleanup());

const CHAT = "chat-shopping-test";
const inbound = (over: Record<string, unknown> = {}) =>
  ({
    platform: "telegram",
    chatId: CHAT,
    externalId: "777000111",
    username: "shopping_tester",
    displayName: "Shopping Tester",
    locale: "ru",
    photos: [],
    ...over,
  }) as never;

const flat = (messages: { buttons?: unknown[][] }[]) => (messages || []).flatMap((m) => (m.buttons || []).flat()) as { kind?: string; text?: string; action?: string; url?: string }[];

/** Photo → style → generation, exactly as a user does it in the chat. */
async function generateInBot() {
  await engine.handleBotUpdate(inbound({ photos: [{ buffer: PNG, mime: "image/png" }] }));
  const styles = await seed.activeStyles();
  const reply = await engine.handleBotUpdate(inbound({ action: `st:${styles[0].id}` }));
  const deferred = reply.task ? await reply.task() : [];
  return [...reply.messages, ...deferred];
}

test("a design arrives in the chat together with its details even when auto-detection is off", async () => {
  await seed.setSetting("shopping_enabled", "1");
  await seed.setSetting("shopping_auto", "0");

  const messages = await generateInBot();
  const shop = messages.find((m) => /Где купить|Where to buy/i.test(m.text || ""));
  assert.ok(shop, "the bot sent the details block");
  assert.ok(!/не распознаны|not detected/i.test(shop!.text || ""), `details must not be empty: ${shop!.text}`);

  const buttons = flat(messages);
  assert.ok(buttons.some((b) => String(b.action || "").startsWith("show_item:")), "details are clickable");
});

test("tapping a detail offers shops and asks before spending a generation", async () => {
  await seed.setSetting("shopping_enabled", "1");
  const messages = await generateInBot();
  const listButtons = flat(messages);
  const first = listButtons.find((b) => String(b.action || "").startsWith("show_item:"));
  assert.ok(first, "the list has a detail button");

  const itemId = String(first!.action).split(":")[1];
  const itemReply = await engine.handleBotUpdate(inbound({ action: `show_item:${itemId}` }));
  const itemButtons = flat(itemReply.messages);
  const links = itemButtons.filter((b) => b.kind === "link");
  assert.ok(links.length > 0, "the detail screen lists marketplaces");
  assert.ok(links.every((b) => /^https?:\/\//.test(b.url || "")), "marketplace links are absolute");
  assert.ok(
    !itemButtons.some((b) => String(b.action || "").startsWith("edit_item:")),
    "the detail screen does not run a generation by itself"
  );
  assert.ok(itemButtons.some((b) => String(b.action || "").startsWith("ask_replace:")), "replacement is offered separately");

  const confirm = await engine.handleBotUpdate(inbound({ action: `ask_replace:${itemId}` }));
  const confirmText = confirm.messages.map((m) => m.text || "").join(" ");
  assert.match(confirmText, /потратит|spends/i);
  assert.ok(flat(confirm.messages).some((b) => String(b.action || "").startsWith("edit_item:")), "the paid action sits behind the confirmation");

  const before = (await store.db()).generations.length;
  const credits = (await store.db()).users.map((u) => u.credits);
  assert.ok(before >= 1, "the design itself was generated");
  assert.ok(credits.length > 0);
});
