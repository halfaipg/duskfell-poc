import zlib from "node:zlib";

export function encodePng(pngWidth, pngHeight, rgba) {
  const scanlines = Buffer.alloc((pngWidth * 4 + 1) * pngHeight);
  for (let y = 0; y < pngHeight; y += 1) {
    const rowStart = y * (pngWidth * 4 + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * pngWidth * 4, (y + 1) * pngWidth * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr(pngWidth, pngHeight)),
    chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(pngWidth, pngHeight) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(pngWidth, 0);
  data.writeUInt32BE(pngHeight, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
