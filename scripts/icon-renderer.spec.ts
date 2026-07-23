import { describe, expect, it } from "vitest";
import { encodePng, renderAppIcon, renderTrayIcon } from "./icon-renderer.js";

function readPngDimensions(png: Buffer): { readonly width: number; readonly height: number } {
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}

describe("icon-renderer", () => {
  it("encodes RGBA pixels as a PNG with matching dimensions", () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 0
    ]);

    const png = encodePng(2, 2, rgba);

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(readPngDimensions(png)).toEqual({ width: 2, height: 2 });
  });

  it("renders tray and app icon buffers at the requested size", () => {
    const trayIcon = renderTrayIcon(16, [255, 255, 255]);
    const appIcon = renderAppIcon(16);

    expect(trayIcon).toHaveLength(16 * 16 * 4);
    expect(appIcon).toHaveLength(16 * 16 * 4);
    expect(Math.max(...trayIcon.filter((_, index) => index % 4 === 3))).toBeGreaterThan(0);
    expect(Math.max(...appIcon.filter((_, index) => index % 4 === 3))).toBeGreaterThan(0);
  });
});
