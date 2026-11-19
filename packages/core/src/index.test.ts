import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@arg/core", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@arg/core");
  });
});
