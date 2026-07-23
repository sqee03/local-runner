import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPayloadManifest,
  collectPayloadFiles,
  createBaseSources,
  type PayloadFile
} from "./create-deno-payload.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-payload-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("create-deno-payload helpers", () => {
  it("builds the default packaged runtime source list", () => {
    const root = makeTempRoot();
    const runtimeRoot = path.join(root, ".tmp", "packaged-runtime");

    expect(createBaseSources(root, runtimeRoot)).toEqual([
      { source: ".tmp/packaged-runtime/config", target: "config" },
      { source: "desktop/assets", target: "desktop/assets" },
      { source: ".tmp/packaged-runtime/dist", target: "dist" },
      { source: ".tmp/packaged-runtime/injections", target: "injections" },
      { source: ".tmp/packaged-runtime/package.json", target: "package.json" },
      { source: ".tmp/packaged-runtime/scripts", target: "scripts" }
    ]);
  });

  it("collects nested files with normalized manifest paths", () => {
    const root = makeTempRoot();
    fs.mkdirSync(path.join(root, "source", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "source", "nested", "file.txt"), "hello", "utf8");
    const files: PayloadFile[] = [];

    collectPayloadFiles(root, "source", "target", files);

    expect(files).toMatchObject([
      {
        path: "target/nested/file.txt",
        base64: Buffer.from("hello").toString("base64")
      }
    ]);
  });

  it("builds deterministic sorted manifests without default runtime downloads", () => {
    const root = makeTempRoot();
    fs.mkdirSync(path.join(root, "payload"), { recursive: true });
    fs.writeFileSync(path.join(root, "payload", "b.txt"), "b", "utf8");
    fs.writeFileSync(path.join(root, "payload", "a.txt"), "a", "utf8");

    const manifest = buildPayloadManifest({
      projectRoot: root,
      packagedRuntimeSource: path.join(root, "payload"),
      target: "windows",
      baseSources: [{ source: "payload", target: "runtime" }],
      runtimeSources: { windows: [] },
      targetSources: { windows: [] },
      requiredRuntimeFiles: { windows: [] }
    });

    expect(manifest.version).toBe(1);
    expect(manifest.target).toBe("windows");
    expect(manifest.files.map((file) => file.path)).toEqual([
      "runtime/a.txt",
      "runtime/b.txt"
    ]);
    expect(manifest.hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("builds manifests from default windows payload sources", () => {
    const root = makeTempRoot();
    const runtimeRoot = path.join(root, ".tmp", "packaged-runtime");
    const requiredDirectories = [
      path.join(runtimeRoot, "config"),
      path.join(root, "desktop", "assets"),
      path.join(runtimeRoot, "dist"),
      path.join(runtimeRoot, "injections"),
      path.join(runtimeRoot, "scripts"),
      path.join(root, ".tmp", "build-tools", "windows-node-x64")
    ];

    for (const directory of requiredDirectories) {
      fs.mkdirSync(directory, { recursive: true });
    }

    fs.writeFileSync(path.join(runtimeRoot, "config", "defaults.json"), "{}", "utf8");
    fs.writeFileSync(path.join(root, "desktop", "assets", "tray-icon.png"), "png", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "dist", "index.html"), "<html></html>", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "injections", "placeholder.txt"), "injection", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), "{}", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "scripts", "orchestrator.js"), "console.log()", "utf8");
    fs.writeFileSync(path.join(root, ".tmp", "build-tools", "windows-node-x64", "node.exe"), "node", "utf8");
    fs.writeFileSync(path.join(root, ".tmp", "build-tools", "windows-node-x64", "nodew.exe"), "nodew", "utf8");

    const manifest = buildPayloadManifest({
      projectRoot: root,
      packagedRuntimeSource: runtimeRoot,
      target: "windows"
    });

    expect(manifest.files.map((file) => file.path)).toContain("package.json");
    expect(manifest.files.map((file) => file.path)).toContain("vendor/windows-node-x64/node.exe");
    expect(manifest.files.map((file) => file.path)).toContain("vendor/windows-node-x64/nodew.exe");
  });

  it("throws when a payload source is missing", () => {
    const root = makeTempRoot();

    expect(() =>
      buildPayloadManifest({
        projectRoot: root,
        packagedRuntimeSource: path.join(root, ".tmp", "packaged-runtime"),
        target: "windows",
        baseSources: [{ source: "missing", target: "missing" }],
        runtimeSources: { windows: [] },
        targetSources: { windows: [] },
        requiredRuntimeFiles: { windows: [] }
      })
    ).toThrow("Missing payload source");
  });
});
