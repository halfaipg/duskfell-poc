import { decodeMsgpack } from "./msgpack-decode.js";
import { normalizeSnapshot } from "./server-message-snapshot.js";
import { isObject, normalizeNoticeLevel, normalizeText, normalizeUuid } from "./server-message-validators.js";

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

  throw new Error(`unsupported server message type ${message.type}`);
}
