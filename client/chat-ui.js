const MAX_SAY_CHARS = 240;
const MAX_HISTORY = 20;

// Chat bar state machine: T near an NPC opens it targeting that NPC. Enter
// sends and keeps the conversation open for follow-ups; Esc closes. Arrow-up/
// down recall previously sent messages. The server re-validates range and
// content; this only shapes input.
export function createChatUi({ input, send, onOpenStateChange }) {
  let target = null;
  const history = [];
  let historyIndex = -1;
  let draft = "";

  function openChat(npc) {
    if (!npc) return;
    target = { id: npc.id, name: npc.name };
    input.hidden = false;
    input.value = "";
    input.placeholder = `Talking to ${npc.name}… (Enter to send, Esc to leave)`;
    historyIndex = -1;
    draft = "";
    input.focus();
    onOpenStateChange?.(true);
  }

  function close() {
    target = null;
    input.hidden = true;
    input.value = "";
    historyIndex = -1;
    input.blur();
    onOpenStateChange?.(false);
  }

  function isOpen() {
    return target != null;
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
    if (text && target) {
      send({ type: "say", npcId: target.id, text });
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
