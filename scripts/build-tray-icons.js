import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(projectRoot, "desktop", "assets");

const outputSize = 22;
const renderSize = 220;
const samplesPerAxis = 4;

function crc32(buffer) {
  let crc = 0xffffffff;

  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgbaBytes) {
  const rowStride = width * 4 + 1;
  const raw = Buffer.alloc(rowStride * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * rowStride] = 0;

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const targetOffset = y * rowStride + 1 + x * 4;
      raw[targetOffset] = rgbaBytes[sourceOffset];
      raw[targetOffset + 1] = rgbaBytes[sourceOffset + 1];
      raw[targetOffset + 2] = rgbaBytes[sourceOffset + 2];
      raw[targetOffset + 3] = rgbaBytes[sourceOffset + 3];
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

function sdRoundedRect(x, y, cx, cy, width, height, radius) {
  const dx = Math.abs(x - cx) - width / 2 + radius;
  const dy = Math.abs(y - cy) - height / 2 + radius;
  const qx = Math.max(dx, 0);
  const qy = Math.max(dy, 0);
  return Math.hypot(qx, qy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function pointInCircle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) <= radius;
}

function pointInRoundedRect(x, y, cx, cy, width, height, radius) {
  return sdRoundedRect(x, y, cx, cy, width, height, radius) <= 0;
}

function pointInS(x, y) {
  const topBar = pointInRoundedRect(x, y, 0, -52, 100, 34, 17);
  const midBar = pointInRoundedRect(x, y, 0, 0, 84, 34, 17);
  const bottomBar = pointInRoundedRect(x, y, 0, 52, 100, 34, 17);
  const upperStem = pointInRoundedRect(x, y, -34, -26, 32, 62, 16);
  const lowerStem = pointInRoundedRect(x, y, 34, 26, 32, 62, 16);

  return topBar || midBar || bottomBar || upperStem || lowerStem;
}

function sampleIcon(foregroundRgb) {
  const pixels = new Uint8Array(outputSize * outputSize * 4);
  const scale = renderSize / outputSize;
  const center = renderSize / 2;
  const radius = 94;
  const sampleStep = scale / samplesPerAxis;
  const sampleOffset = sampleStep / 2;

  for (let py = 0; py < outputSize; py += 1) {
    for (let px = 0; px < outputSize; px += 1) {
      let fillHits = 0;
      let cutoutHits = 0;

      for (let sy = 0; sy < samplesPerAxis; sy += 1) {
        for (let sx = 0; sx < samplesPerAxis; sx += 1) {
          const x = px * scale + sx * sampleStep + sampleOffset;
          const y = py * scale + sy * sampleStep + sampleOffset;
          const localX = x - center;
          const localY = y - center;

          if (pointInCircle(x, y, center, center, radius)) {
            fillHits += 1;

            if (pointInS(localX, localY)) {
              cutoutHits += 1;
            }
          }
        }
      }

      const totalSamples = samplesPerAxis * samplesPerAxis;
      const alpha = Math.round(((fillHits - cutoutHits) / totalSamples) * 255);
      const offset = (py * outputSize + px) * 4;

      pixels[offset] = foregroundRgb[0];
      pixels[offset + 1] = foregroundRgb[1];
      pixels[offset + 2] = foregroundRgb[2];
      pixels[offset + 3] = Math.max(0, Math.min(255, alpha));
    }
  }

  return pixels;
}

function main() {
  fs.mkdirSync(assetsDir, { recursive: true });

  const lightIcon = encodePng(outputSize, outputSize, sampleIcon([18, 18, 18]));
  const darkIcon = encodePng(outputSize, outputSize, sampleIcon([255, 255, 255]));

  fs.writeFileSync(path.join(assetsDir, "tray-icon.png"), lightIcon);
  fs.writeFileSync(path.join(assetsDir, "tray-icon-dark.png"), darkIcon);

  console.log("Updated tray icons.");
}

main();
