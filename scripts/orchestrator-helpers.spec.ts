import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeState } from "./node-types.js";
import {
  applyRuntimePortOverrides,
  buildPackageRuntimeConfig,
  contentTypeFor,
  normalizeConfigForClient,
  normalizeRuntimeForClient,
  resolveStaticAssetPath
} from "./orchestrator-helpers.js";
import { createConfigSnapshot } from "./config-fixtures.spec-helper.js";

describe("orchestrator helpers", () => {
  it("maps common static asset content types", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("manifest.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("icon.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("asset.bin")).toBe("application/octet-stream");
  });

  it("normalizes config snapshots with explicit file paths", () => {
    const snapshot = createConfigSnapshot();

    expect(normalizeConfigForClient(snapshot, {
      defaultConfig: "/config/defaults.json",
      userConfig: "/config/user-overrides.json"
    })).toMatchObject({
      effective: snapshot.effective,
      filePaths: {
        defaultConfig: "/config/defaults.json",
        userConfig: "/config/user-overrides.json"
      }
    });
  });

  it("normalizes runtime state without exposing child process handles", () => {
    const runtimeState: RuntimeState = {
      isRunning: true,
      isTransitioning: false,
      lastError: null,
      currentConfig: {
        ...createConfigSnapshot().effective,
        frontendAppUrl: "http://127.0.0.1:4300"
      },
      packageStatus: {
        fe: "running",
        be: "running",
        mqtt: "running"
      },
      packageProcesses: {
        fe: null,
        be: null,
        mqtt: null
      }
    };

    expect(normalizeRuntimeForClient(runtimeState)).toEqual({
      isRunning: true,
      isTransitioning: false,
      lastError: null,
      currentConfig: runtimeState.currentConfig,
      packageStatus: runtimeState.packageStatus
    });
  });

  it("applies only finite runtime port overrides", () => {
    const snapshot = createConfigSnapshot();
    const next = applyRuntimePortOverrides(snapshot, {
      runner: 5000,
      frontendPackage: Number.NaN,
      mqttTcp: 18884
    });

    expect(next.effective.ports).toEqual({
      runner: 5000,
      frontendPackage: 4300,
      mqttTcp: 18884,
      mqttWs: 19001
    });
    expect(snapshot.effective.ports.runner).toBe(4173);
  });

  it("builds package definitions without launching injected processes", () => {
    const projectRoot = path.resolve("/project");
    const runtimeRoot = path.resolve("/runtime");
    const snapshot = createConfigSnapshot({
      paths: {
        backendExecutable: "/bin/custom-node",
        backendWorkingDirectory: "backend-workdir"
      }
    });

    const config = buildPackageRuntimeConfig(snapshot, {
      projectRoot,
      runtimeRoot,
      nodeExecutable: "/usr/bin/node",
      environment: {
        EXISTING: "1"
      },
      entryExists: (absolutePath) => absolutePath.endsWith("injections/fe/server.js")
    });

    expect(config.host).toBe("127.0.0.1");
    expect(config.mqttTopic).toBe("mvp/test");
    expect(config.packageDefinitions.fe.executable).toBe("/usr/bin/node");
    expect(config.packageDefinitions.fe.entry).toBe(
      path.resolve(projectRoot, "./injections/fe/server.js")
    );
    expect(config.packageDefinitions.be.executable).toBe("/bin/custom-node");
    expect(config.packageDefinitions.be.entry).toBe(
      path.resolve(runtimeRoot, "./injections/be/server.js")
    );
    expect(config.packageDefinitions.be.cwd).toBe(path.resolve(projectRoot, "backend-workdir"));
    expect(config.packageDefinitions.be.env.MQTT_TCP_URL).toBe("mqtt://127.0.0.1:18883");
    expect(config.packageDefinitions.fe.env.FE_PORT).toBe("4300");
    expect(config.packageDefinitions.mqtt.env.MQTT_WS_PORT).toBe("19001");
    expect(config.packageDefinitions.mqtt.env.EXISTING).toBe("1");
  });

  it("resolves static asset paths inside dist with index fallback", () => {
    const distDir = path.resolve("/project/dist");
    const existingFiles = new Set([
      path.join(distDir, "index.html"),
      path.join(distDir, "assets", "app.js")
    ]);
    const resolvePath = (rawPath: string) =>
      resolveStaticAssetPath({
        distDir,
        rawPath,
        exists: (absolutePath) => existingFiles.has(absolutePath),
        isDirectory: () => false
      });

    expect(resolvePath("/assets/app.js")).toBe(path.join(distDir, "assets", "app.js"));
    expect(resolvePath("/missing.js")).toBe(path.join(distDir, "index.html"));
    expect(resolvePath("/../../package.json")).toBe(path.join(distDir, "index.html"));
  });
});
