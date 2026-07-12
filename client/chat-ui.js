const MAX_SAY_CHARS = 240;
const MAX_HISTORY = 20;

// Chat bar state machine: Enter (or T near an NPC) opens it — targeting the
// NPC when one is in range, plain overhead speech otherwise. Enter sends and
// keeps the conversation open for follow-ups; Esc closes. Arrow-up/down
// recall previously sent messages. The server re-validates range and content;
// this only shapes input.
export function createChatUi({ input, send, onOpenStateChange }) {
  let open = false;
  let target = null;
  const history = [];
  let historyIndex = -1;
  let draft = "";

  function openChat(npc = null) {
    open = true;
    target = npc ? { id: npc.id, name: npc.name } : null;
    input.hidden = false;
    input.value = "";
    input.placeholder = target
      ? `Talking to ${target.name}… (Enter to send, Esc to leave)`
      : "Say something… (Enter to send, Esc to leave)";
    historyIndex = -1;
    draft = "";
    input.focus();
    onOpenStateChange?.(true);
  }

  function close() {
    open = false;
    target = null;
    input.hidden = true;
    input.value = "";
    historyIndex = -1;
    input.blur();
    onOpenStateChange?.(false);
  }

  function isOpen() {
    return open;
  }

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      recallOlder();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      recallNewer();
      return;
    }
    if (event.key !== "Enter") return;
    const text = input.value.trim().slice(0, MAX_SAY_CHARS);
    if (text) {
      const payload = target
        ? { type: "say", npcId: target.id, text }
        : { type: "say", text };
      send(payload);
      history.push(text);
      if (history.length > MAX_HISTORY) {
        history.shift();
      }
    }
    // Stay in the conversation: clear the box for the next line.
    input.value = "";
    historyIndex = -1;
    draft = "";
  });

  function recallOlder() {
    if (history.length === 0) return;
    if (historyIndex === -1) {
      draft = input.value;
      historyIndex = history.length - 1;
    } else if (historyIndex > 0) {
      historyIndex -= 1;
    }
    input.value = history[historyIndex];
  }

  function recallNewer() {
    if (historyIndex === -1) return;
    historyIndex += 1;
    if (historyIndex > history.length - 1) {
      // Walked past the newest entry: restore the in-progress draft.
      historyIndex = -1;
      input.value = draft;
      return;
    }
    input.value = history[historyIndex];
  }

  return { openChat, close, isOpen };
}
