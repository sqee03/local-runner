import zlib from "node:zlib";

const designSize = 220;
const samplesPerAxis = 4;
type Rgb = readonly [number, number, number];

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

export function encodePng(width: number, height: number, rgbaBytes: Uint8Array): Buffer {
  const rowStride = width * 4 + 1;
  const raw = Buffer.alloc(rowStride * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * rowStride] = 0;

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const targetOffset = y * rowStride + 1 + x * 4;
      raw[targetOffset] = rgbaBytes[sourceOffset] ?? 0;
      raw[targetOffset + 1] = rgbaBytes[sourceOffset + 1] ?? 0;
      raw[targetOffset + 2] = rgbaBytes[sourceOffset + 2] ?? 0;
      raw[targetOffset + 3] = rgbaBytes[sourceOffset + 3] ?? 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function sdRoundedRect(
  x: number,
  y: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  radius: number
): number {
  const dx = Math.abs(x - cx) - width / 2 + radius;
  const dy = Math.abs(y - cy) - height / 2 + radius;
  const qx = Math.max(dx, 0);
  const qy = Math.max(dy, 0);
  return Math.hypot(qx, qy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function pointInCircle(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  return Math.hypot(x - cx, y - cy) <= radius;
}

function pointInRoundedRect(
  x: number,
  y: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  radius: number
): boolean {
  return sdRoundedRect(x, y, cx, cy, width, height, radius) <= 0;
}

function pointInTraySymbol(x: number, y: number): boolean {
  const topBar = pointInRoundedRect(x, y, 0, -52, 100, 34, 17);
  const midBar = pointInRoundedRect(x, y, 0, 0, 84, 34, 17);
  const bottomBar = pointInRoundedRect(x, y, 0, 52, 100, 34, 17);
  const upperStem = pointInRoundedRect(x, y, -34, -26, 32, 62, 16);
  const lowerStem = pointInRoundedRect(x, y, 34, 26, 32, 62, 16);

  return topBar || midBar || bottomBar || upperStem || lowerStem;
}

function sampleCoverage(
  size: number,
  pixelX: number,
  pixelY: number
): { readonly circleHits: number; readonly symbolHits: number } {
  const scale = designSize / size;
  const center = designSize / 2;
  const sampleStep = scale / samplesPerAxis;
  const sampleOffset = sampleStep / 2;
  let circleHits = 0;
  let symbolHits = 0;

  for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
    for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
      const x = pixelX * scale + sampleX * sampleStep + sampleOffset;
      const y = pixelY * scale + sampleY * sampleStep + sampleOffset;

      if (pointInCircle(x, y, center, center, 94)) {
        circleHits += 1;

        if (pointInTraySymbol(x - center, y - center)) {
          symbolHits += 1;
        }
      }
    }
  }

  return { circleHits, symbolHits };
}

export function renderTrayIcon(size: number, foregroundRgb: Rgb): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const totalSamples = samplesPerAxis * samplesPerAxis;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const { circleHits, symbolHits } = sampleCoverage(size, x, y);
      const offset = (y * size + x) * 4;

      pixels[offset] = foregroundRgb[0];
      pixels[offset + 1] = foregroundRgb[1];
      pixels[offset + 2] = foregroundRgb[2];
      pixels[offset + 3] = Math.round(((circleHits - symbolHits) / totalSamples) * 255);
    }
  }

  return pixels;
}

export function renderAppIcon(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const totalSamples = samplesPerAxis * samplesPerAxis;
  const circleRgb: Rgb = [12, 14, 16];
  const symbolRgb: Rgb = [255, 255, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const { circleHits, symbolHits } = sampleCoverage(size, x, y);
      const offset = (y * size + x) * 4;
      const circleOnlyHits = circleHits - symbolHits;

      if (circleHits > 0) {
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[offset + channel] = Math.round(
            ((circleRgb[channel] ?? 0) * circleOnlyHits + (symbolRgb[channel] ?? 0) * symbolHits) /
              circleHits
          );
        }
      }

      pixels[offset + 3] = Math.round((circleHits / totalSamples) * 255);
    }
  }

  return pixels;
}
