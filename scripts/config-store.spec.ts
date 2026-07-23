import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLED_CONFIG_DIR_ENV,
  USER_CONFIG_DIR_ENV,
  createConfigStore
} from "./config-store.js";
import { createRunnerConfig } from "./config-fixtures.spec-helper.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-config-store-"));
  tempRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  delete process.env[BUNDLED_CONFIG_DIR_ENV];
  delete process.env[USER_CONFIG_DIR_ENV];
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("createConfigStore", () => {
  it("copies bundled defaults and creates empty user overrides", () => {
    const root = makeTempRoot();
    const bundledConfigDir = path.join(root, "bundled");
    const writableConfigDir = path.join(root, "writable");
    const defaults = createRunnerConfig();
    writeJson(path.join(bundledConfigDir, "defaults.json"), defaults);
    process.env[BUNDLED_CONFIG_DIR_ENV] = bundledConfigDir;
    process.env[USER_CONFIG_DIR_ENV] = writableConfigDir;

    const snapshot = createConfigStore(root).readConfig();

    expect(snapshot.effective).toEqual(defaults);
    expect(JSON.parse(fs.readFileSync(path.join(writableConfigDir, "defaults.json"), "utf8"))).toEqual(defaults);
    expect(JSON.parse(fs.readFileSync(path.join(writableConfigDir, "user-overrides.json"), "utf8"))).toEqual({});
  });

  it("deep merges user overrides over defaults", () => {
    const root = makeTempRoot();
    const configDir = path.join(root, "config");
    writeJson(path.join(configDir, "defaults.json"), createRunnerConfig());
    writeJson(path.join(configDir, "user-overrides.json"), {
      ports: {
        frontendPackage: 4400
      },
      mqtt: {
        testTopic: "override/topic"
      }
    });

    const snapshot = createConfigStore(root).readConfig();

    expect(snapshot.effective.ports.runner).toBe(4173);
    expect(snapshot.effective.ports.frontendPackage).toBe(4400);
    expect(snapshot.effective.mqtt.testTopic).toBe("override/topic");
  });

  it("writes user overrides and returns the updated snapshot", () => {
    const root = makeTempRoot();
    const configDir = path.join(root, "config");
    writeJson(path.join(configDir, "defaults.json"), createRunnerConfig());

    const store = createConfigStore(root);
    const snapshot = store.writeUserOverrides({
      interfaces: {
        host: "0.0.0.0"
      }
    });

    expect(snapshot.effective.interfaces.host).toBe("0.0.0.0");
    expect(JSON.parse(fs.readFileSync(store.userConfigPath, "utf8"))).toEqual({
      interfaces: {
        host: "0.0.0.0"
      }
    });
  });

  it("rejects invalid effective config shapes", () => {
    const root = makeTempRoot();
    const configDir = path.join(root, "config");
    writeJson(path.join(configDir, "defaults.json"), {
      ports: {
        runner: 4173
      }
    });

    expect(() => createConfigStore(root).readConfig()).toThrow(
      "Effective config is missing required runner settings"
    );
  });
});
