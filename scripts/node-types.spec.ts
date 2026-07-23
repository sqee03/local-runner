import { describe, expect, it } from "vitest";
import { errorMessage, isJsonObject, isReleaseTarget } from "./node-types.js";

describe("node-types", () => {
  it("narrows supported release targets", () => {
    expect(isReleaseTarget("windows")).toBe(true);
    expect(isReleaseTarget("mac-arm64")).toBe(true);
    expect(isReleaseTarget("linux")).toBe(false);
    expect(isReleaseTarget(undefined)).toBe(false);
  });

  it("recognizes plain JSON objects only", () => {
    expect(isJsonObject({ value: true })).toBe(true);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(["value"])).toBe(false);
    expect(isJsonObject("value")).toBe(false);
  });

  it("formats unknown errors consistently", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain failure")).toBe("plain failure");
  });
});
