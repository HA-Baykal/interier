import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { isolateStorage, TEST_USER } from "./helpers";

let cleanup: () => void;
let store: typeof import("../src/lib/db");
let seed: typeof import("../src/lib/config");
let engine: typeof import("../src/lib/bots/engine");
let types: typeof import("../src/lib/bots/types");

before(async () => {
  cleanup = isolateStorage();
  store = await import("../src/lib/db");
  seed = await import("../src/lib/config");
  engine = await import("../src/lib/bots/engine");
  types = await import("../src/lib/bots/types");
});

beforeEach(async () => {
  await store.resetDb();
  await seed.ensureSeeded();
  await store.mutate((d) => {
    d.users.push({ ...TEST_USER });
  });
});

after(() => cleanup());

test("bot /start flow returns main menu with Mini App button and no text-design buttons", async () => {
  const reply = await engine.handleBotUpdate({
    platform: "telegram",
    chatId: "chat-1",
    externalId: "10001",
    displayName: "Иван",
    text: "/start",
  });

  assert.equal(reply.messages.length, 2);
  const welcome = reply.messages[0];
  const menuMsg = reply.messages[1];

  assert.ok(welcome.text?.includes("Иван"));
  assert.ok(welcome.text?.includes("Interier AI"));

  // Check buttons in menu
  const buttons = menuMsg.buttons || [];
  assert.ok(buttons.length >= 3);

  // First button is Mini App button
  const firstRow = buttons[0];
  assert.equal(firstRow[0]?.kind, "app");
  assert.ok(firstRow[0]?.text.includes("Открыть приложение"));
  assert.ok(firstRow[0]?.url.startsWith("http"));

  // Has history and referral buttons
  const secondRow = buttons[1];
  assert.ok(secondRow.some((b) => b?.action === types.ACTION.HISTORY));
  assert.ok(secondRow.some((b) => b?.action === types.ACTION.REFERRAL));

  // Has lang and help buttons
  const thirdRow = buttons[2];
  assert.ok(thirdRow.some((b) => b?.action?.startsWith(types.ACTION.LANG)));
  assert.ok(thirdRow.some((b) => b?.action === types.ACTION.HELP));

  // No text generation button in menu
  const allActions = buttons.flat().map((b) => b?.action).filter(Boolean);
  assert.ok(!allActions.includes("new"));
  assert.ok(!allActions.includes("desc"));
});

test("sending a photo informs user that generation is in Mini App with button", async () => {
  const reply = await engine.handleBotUpdate({
    platform: "telegram",
    chatId: "chat-2",
    externalId: "10002",
    photos: [{ buffer: Buffer.from("fake photo bytes"), mime: "image/jpeg" }],
  });

  assert.equal(reply.messages.length, 1);
  const msg = reply.messages[0];
  assert.ok(msg.text?.includes("мини-приложении"));
  const btn = msg.buttons?.[0]?.[0];
  assert.equal(btn?.kind, "app");
  assert.ok(btn?.text.includes("Открыть приложение"));
});

test("sending plain text guides user to open Mini App", async () => {
  const reply = await engine.handleBotUpdate({
    platform: "telegram",
    chatId: "chat-3",
    externalId: "10003",
    text: "хочу спальню в стиле лофт",
  });

  assert.equal(reply.messages.length, 2);
  const guide = reply.messages[0];
  assert.ok(guide.text?.includes("мини-приложении"));
  const btn = guide.buttons?.[0]?.[0];
  assert.equal(btn?.kind, "app");
});

test("commands /new and /design direct user to Mini App", async () => {
  for (const cmd of ["/new", "/design"]) {
    const reply = await engine.handleBotUpdate({
      platform: "telegram",
      chatId: "chat-4",
      externalId: "10004",
      text: cmd,
    });
    assert.equal(reply.messages.length, 1);
    assert.ok(reply.messages[0].text?.includes("мини-приложении"));
    assert.equal(reply.messages[0].buttons?.[0]?.[0]?.kind, "app");
  }
});

test("history shows designs and empty state provides Mini App button", async () => {
  // Empty history
  const emptyReply = await engine.handleBotUpdate({
    platform: "telegram",
    chatId: "chat-5",
    externalId: "10005",
    text: "/history",
  });
  assert.equal(emptyReply.messages.length, 1);
  assert.ok(emptyReply.messages[0].text?.includes("нет сохранённых дизайнов"));
  assert.equal(emptyReply.messages[0].buttons?.[0]?.[0]?.kind, "app");

  // User with an existing generation
  const userId = "usr-with-designs";
  const tgId = 987654321;
  await store.mutate((d) => {
    d.users.push({
      ...TEST_USER,
      id: userId,
      telegramId: tgId,
    });
    d.generations.push({
      id: "gen-test-1",
      userId,
      styleId: "style_loft",
      originalId: "orig-1",
      originalUrl: "/uploads/orig.jpg",
      resultUrl: "/uploads/res.jpg",
      status: "completed",
      error: null,
      mode: "demo",
      provider: "demo",
      createdAt: Date.now(),
      published: false,
      shopping: {
        items: [
          {
            id: "item-1",
            name: "Люстра лофт",
            category: "lighting",
            query: "люстра лофт черная",
            links: [{ marketplace: "ozon", title: "Ozon", url: "https://ozon.ru/search?text=люстра" }],
          },
        ],
      },
    });
  });

  const populatedReply = await engine.handleBotUpdate({
    platform: "telegram",
    chatId: "chat-6",
    externalId: String(tgId),
    text: "/history",
  });

  // History lists the design button
  assert.equal(populatedReply.messages.length, 1);
  const histButtons = populatedReply.messages[0].buttons || [];
  assert.ok(histButtons.some((row) => row.some((b) => b?.action === `${types.ACTION.VIEW_GEN}:gen-test-1`)));

  // View the generation
  const viewReply = await engine.handleBotUpdate({
    platform: "telegram",
    chatId: "chat-6",
    externalId: String(tgId),
    action: `${types.ACTION.VIEW_GEN}:gen-test-1`,
  });

  assert.equal(viewReply.messages.length, 2);
  const imgMsg = viewReply.messages[0];
  assert.ok(imgMsg.photoUrl);
  const shopMsg = viewReply.messages[1];
  assert.ok(shopMsg.text?.includes("Где купить детали"));
  assert.ok(shopMsg.buttons?.some((row) => row.some((b) => b?.kind === "link" && b.url.includes("ozon.ru"))));
});
