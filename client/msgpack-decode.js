// Minimal MessagePack decoder for server snapshot frames (rmp-serde,
// to_vec_named: maps carry string field keys, so decoded objects feed the
// same normalizers as JSON did). Covers the types serde emits — nil, bool,
// all int widths, f32/f64, str, bin, array, map. No ext types, no bigints:
// 64-bit ints beyond Number.MAX_SAFE_INTEGER throw rather than corrupt.
export function decodeMsgpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state = { bytes, view, offset: 0 };
  const value = readValue(state);
  if (state.offset !== bytes.byteLength) {
    throw new Error("msgpack payload has trailing bytes");
  }
  return value;
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });

function readValue(state) {
  const byte = takeByte(state);

  if (byte <= 0x7f) return byte;                       // positive fixint
  if (byte >= 0xe0) return byte - 0x100;               // negative fixint
  if (byte >= 0x80 && byte <= 0x8f) return readMap(state, byte & 0x0f);
  if (byte >= 0x90 && byte <= 0x9f) return readArray(state, byte & 0x0f);
  if (byte >= 0xa0 && byte <= 0xbf) return readString(state, byte & 0x1f);

  switch (byte) {
    case 0xc0: return null;
    case 0xc2: return false;
    case 0xc3: return true;
    case 0xc4: return readBinary(state, takeUint(state, 1));
    case 0xc5: return readBinary(state, takeUint(state, 2));
    case 0xc6: return readBinary(state, takeUint(state, 4));
    case 0xca: { const v = state.view.getFloat32(state.offset); state.offset += 4; return v; }
    case 0xcb: { const v = state.view.getFloat64(state.offset); state.offset += 8; return v; }
    case 0xcc: return takeUint(state, 1);
    case 0xcd: return takeUint(state, 2);
    case 0xce: return takeUint(state, 4);
    case 0xcf: return takeBigUint64(state);
    case 0xd0: { const v = state.view.getInt8(state.offset); state.offset += 1; return v; }
    case 0xd1: { const v = state.view.getInt16(state.offset); state.offset += 2; return v; }
    case 0xd2: { const v = state.view.getInt32(state.offset); state.offset += 4; return v; }
    case 0xd3: return takeBigInt64(state);
    case 0xd9: return readString(state, takeUint(state, 1));
    case 0xda: return readString(state, takeUint(state, 2));
    case 0xdb: return readString(state, takeUint(state, 4));
    case 0xdc: return readArray(state, takeUint(state, 2));
    case 0xdd: return readArray(state, takeUint(state, 4));
    case 0xde: return readMap(state, takeUint(state, 2));
    case 0xdf: return readMap(state, takeUint(state, 4));
    default:
      throw new Error(`msgpack type 0x${byte.toString(16)} is unsupported`);
  }
}

function takeByte(state) {
  if (state.offset >= state.bytes.byteLength) {
    throw new Error("msgpack payload truncated");
  }
  return state.bytes[state.offset++];
}

function takeUint(state, width) {
  let value = 0;
  for (let index = 0; index < width; index += 1) {
    value = value * 256 + takeByte(state);
  }
  return value;
}

function takeBigUint64(state) {
  const value = state.view.getBigUint64(state.offset);
  state.offset += 8;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("msgpack u64 exceeds safe integer range");
  }
  return Number(value);
}

function takeBigInt64(state) {
  const value = state.view.getBigInt64(state.offset);
  state.offset += 8;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("msgpack i64 exceeds safe integer range");
  }
  return Number(value);
}

function readString(state, length) {
  const slice = state.bytes.subarray(state.offset, state.offset + length);
  if (slice.byteLength !== length) throw new Error("msgpack string truncated");
  state.offset += length;
  return textDecoder.decode(slice);
}

function readBinary(state, length) {
  const slice = state.bytes.slice(state.offset, state.offset + length);
  if (slice.byteLength !== length) throw new Error("msgpack binary truncated");
  state.offset += length;
  return slice;
}

function readArray(state, length) {
  const out = new Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = readValue(state);
  }
  return out;
}

function readMap(state, length) {
  const out = {};
  for (let index = 0; index < length; index += 1) {
    const key = readValue(state);
    if (typeof key !== "string") throw new Error("msgpack map keys must be strings");
    const value = readValue(state);
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    out[key] = value;
  }
  return out;
}
