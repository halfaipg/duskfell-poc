import assert from "node:assert/strict";
import test from "node:test";

import { createChatUi } from "./chat-ui.js";

function fakeInput() {
  const listeners = new Map();
  return {
    hidden: true,
    value: "",
    placeholder: "",
    focus() {},
    blur() {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    press(key) {
      listeners.get("keydown")({
        key,
        stopPropagation() {},
        preventDefault() {},
      });
    },
  };
}

const maren = { id: "maren", name: "Maren" };

test("enter sends and keeps the conversation open", () => {
  const input = fakeInput();
  const sent = [];
  const chat = createChatUi({ input, send: (payload) => sent.push(payload) });
  chat.openChat(maren);
  input.value = "hello";
  input.press("Enter");
  assert.deepEqual(sent, [{ type: "say", npcId: "maren", text: "hello" }]);
  assert.equal(chat.isOpen(), true, "chat stays open for follow-ups");
  assert.equal(input.value, "", "box clears for the next line");

  input.press("Escape");
  assert.equal(chat.isOpen(), false);
  assert.equal(input.hidden, true);
});

test("arrow keys recall sent messages and restore the draft", () => {
  const input = fakeInput();
  const chat = createChatUi({ input, send: () => {} });
  chat.openChat(maren);
  for (const text of ["first", "second"]) {
    input.value = text;
    input.press("Enter");
  }
  input.value = "draft in progress";
  input.press("ArrowUp");
  assert.equal(input.value, "second");
  input.press("ArrowUp");
  assert.equal(input.value, "first");
  input.press("ArrowUp");
  assert.equal(input.value, "first", "stops at the oldest entry");
  input.press("ArrowDown");
  assert.equal(input.value, "second");
  input.press("ArrowDown");
  assert.equal(input.value, "draft in progress", "walking past newest restores the draft");
});

test("empty input on enter sends nothing but stays open", () => {
  const input = fakeInput();
  const sent = [];
  const chat = createChatUi({ input, send: (payload) => sent.push(payload) });
  chat.openChat(maren);
  input.value = "   ";
  input.press("Enter");
  assert.equal(sent.length, 0);
  assert.equal(chat.isOpen(), true);
});
