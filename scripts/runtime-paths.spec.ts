import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectRoot } from "./runtime-paths.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-runtime-paths-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveProjectRoot", () => {
  it("walks up until it finds package metadata and config", () => {
    const root = makeTempRoot();
    const nested = path.join(root, "a", "b", "c");
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
    fs.mkdirSync(nested, { recursive: true });

    expect(resolveProjectRoot(nested)).toBe(root);
  });

  it("throws when no project root markers exist", () => {
    const root = makeTempRoot();
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested, { recursive: true });

    expect(() => resolveProjectRoot(nested)).toThrow("Unable to resolve project root");
  });
});
