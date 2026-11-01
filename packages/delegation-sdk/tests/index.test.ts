import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "../src/index.js";

describe("Delegation SDK", () => {
  it("exports valid SDK version", () => {
    expect(SDK_VERSION).toBe("0.1.0");
  });
});
