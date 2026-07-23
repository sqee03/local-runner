import { describe, expect, it } from "vitest";
import {
  getValueAtPath,
  removeValueAtPath,
  setValueAtPath
} from "./config-fields.js";

describe("config field helpers", () => {
  it("reads nested values and returns undefined for missing paths", () => {
    const config = {
      ports: {
        runner: 4173
      }
    };

    expect(getValueAtPath(config, "ports.runner")).toBe(4173);
    expect(getValueAtPath(config, "ports.mqttTcp")).toBeUndefined();
  });

  it("sets nested values immutably", () => {
    const config = {
      ports: {
        runner: 4173
      }
    };

    const next = setValueAtPath(config, "ports.frontendPackage", 4300);

    expect(next).toEqual({
      ports: {
        runner: 4173,
        frontendPackage: 4300
      }
    });
    expect(config).toEqual({
      ports: {
        runner: 4173
      }
    });
  });

  it("removes nested values and prunes empty parent objects", () => {
    const next = removeValueAtPath({
      ports: {
        runner: 4173
      },
      mqtt: {
        testTopic: "mvp/test"
      }
    }, "ports.runner");

    expect(next).toEqual({
      mqtt: {
        testTopic: "mvp/test"
      }
    });
  });
});
