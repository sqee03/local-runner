import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPackageMetadata, resolveStaged } from "./prepare-packaged-runtime.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-package-metadata-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("readPackageMetadata", () => {
  it("resolves paths inside the packaged runtime staging directory", () => {
    expect(resolveStaged("package.json")).toMatch(
      /[/\\]\.tmp[/\\]packaged-runtime[/\\]package\.json$/
    );
  });

  it("reads root package metadata by default", () => {
    expect(readPackageMetadata()).toMatchObject({
      name: "local-mqtt-app-simulator"
    });
  });

  it("reads package name and version", () => {
    const root = makeTempRoot();
    const packagePath = path.join(root, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ name: "simulator", version: "0.1.0" }), "utf8");

    expect(readPackageMetadata(packagePath)).toEqual({
      name: "simulator",
      version: "0.1.0"
    });
  });

  it("rejects package metadata without string name and version", () => {
    const root = makeTempRoot();
    const packagePath = path.join(root, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ name: "simulator" }), "utf8");

    expect(() => readPackageMetadata(packagePath)).toThrow(
      "package.json is missing string name/version fields"
    );
  });
});
