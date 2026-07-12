import { decodeMsgpack } from "./msgpack-decode.js";
import { normalizeSnapshot } from "./server-message-snapshot.js";
import {
  isObject,
  normalizeBoolean,
  normalizeNonNegativeInteger,
  normalizeNoticeLevel,
  normalizeText,
  normalizeUuid,
} from "./server-message-validators.js";

const NPC_SAY_SOURCES = new Set(["canned", "live"]);
const MAX_NPC_SAY_FRAME_CHARS = 256;

export function parseServerMessage(raw) {
  let message;
  try {
    if (raw instanceof ArrayBuffer) {
      message = decodeMsgpack(new Uint8Array(raw));
    } else if (ArrayBuffer.isView(raw)) {
      message = decodeMsgpack(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    } else {
      message = JSON.parse(String(raw));
    }
  } catch {
    throw new Error("server message is not valid JSON or MessagePack");
  }

  if (!isObject(message) || typeof message.type !== "string") {
    throw new Error("server message type is missing");
  }

  if (message.type === "welcome") {
    return {
      type: "welcome",
      playerId: normalizeUuid(message.playerId, "welcome.playerId"),
      snapshot: normalizeSnapshot(message.snapshot, "welcome.snapshot"),
    };
  }
  if (message.type === "snapshot") {
    return {
      type: "snapshot",
      ...normalizeSnapshot(message, "snapshot"),
    };
  }
  if (message.type === "notice") {
    return {
      type: "notice",
      level: normalizeNoticeLevel(message.level),
      message: normalizeText(message.message, "notice.message"),
    };
  }
  if (message.type === "npcSay") {
    if (typeof message.text !== "string" || message.text.length > MAX_NPC_SAY_FRAME_CHARS) {
      throw new Error("npcSay.text must be a bounded string");
    }
    if (!NPC_SAY_SOURCES.has(message.source)) {
      throw new Error("npcSay.source must be canned or live");
    }
    return {
      type: "npcSay",
      npcId: normalizeText(message.npcId, "npcSay.npcId"),
      sayId: normalizeUuid(message.sayId, "npcSay.sayId"),
      seq: normalizeNonNegativeInteger(message.seq, "npcSay.seq"),
      text: message.text,
      done: normalizeBoolean(message.done, "npcSay.done"),
      source: message.source,
    };
  }

  throw new Error(`unsupported server message type ${message.type}`);
}
