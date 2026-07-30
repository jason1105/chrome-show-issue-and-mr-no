const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const sizes = [16, 32, 48, 128];
const outputDirectory = path.resolve(__dirname, '../icons');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function createCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return crc >>> 0;
  });
}

const crcTable = createCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function inRoundedSquare(x, y, size) {
  const inset = Math.max(1, Math.round(size / 32));
  const radius = Math.max(3, Math.round(size * 0.19));
  const min = inset;
  const max = size - inset - 1;

  if (x >= min + radius && x <= max - radius) return y >= min && y <= max;
  if (y >= min + radius && y <= max - radius) return x >= min && x <= max;

  const centerX = x < min + radius ? min + radius : max - radius;
  const centerY = y < min + radius ? min + radius : max - radius;
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

function inHash(x, y, size) {
  const thickness = Math.max(2, Math.round(size * 0.1));
  const verticalTop = Math.round(size * 0.2);
  const verticalBottom = Math.round(size * 0.8);
  const leftBar = Math.round(size * 0.34);
  const rightBar = Math.round(size * 0.58);
  const upperBar = Math.round(size * 0.4);
  const lowerBar = Math.round(size * 0.61);
  const horizontalLeft = Math.round(size * 0.16);
  const horizontalRight = Math.round(size * 0.84);

  const inVerticalRange = y >= verticalTop && y < verticalBottom;
  const inLeftBar = x >= leftBar && x < leftBar + thickness;
  const inRightBar = x >= rightBar && x < rightBar + thickness;
  const inHorizontalRange = x >= horizontalLeft && x < horizontalRight;
  const inUpperBar = y >= upperBar && y < upperBar + thickness;
  const inLowerBar = y >= lowerBar && y < lowerBar + thickness;

  return (inVerticalRange && (inLeftBar || inRightBar))
    || (inHorizontalRange && (inUpperBar || inLowerBar));
}

function createRgbaRows(size) {
  const stride = size * 4 + 1;
  const rows = Buffer.alloc(stride * size);

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * stride;
    rows[rowOffset] = 0;

    for (let x = 0; x < size; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      if (!inRoundedSquare(x, y, size)) continue;

      const color = inHash(x, y, size)
        ? [23, 19, 33, 255]
        : [252, 109, 38, 255];
      rows.set(color, pixelOffset);
    }
  }

  return rows;
}

function createPng(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    pngSignature,
    createChunk('IHDR', header),
    createChunk('IDAT', zlib.deflateSync(createRgbaRows(size), { level: 9 })),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const size of sizes) {
  fs.writeFileSync(path.join(outputDirectory, `icon-${size}.png`), createPng(size));
}
