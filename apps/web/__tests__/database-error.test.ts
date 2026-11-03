import { describe, expect, it } from "vitest";
import { databaseFailure } from "@/lib/db/error";
describe("public database errors", () => {
  it("identifies missing migrations inside a wrapped database error", () => {
    expect(databaseFailure(new Error("Failed query: private SQL", { cause: Object.assign(new Error("private"), { code: "42703" }) }))).toContain("schema needs updating");
  });
  it("hides SQL and identity parameters for connection failures", () => {
    const result = databaseFailure(new Error("Failed query: select private params: secret", { cause: new Error("fetch failed") }));
    expect(result).toContain("database connection");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("select");
  });
  it("preserves ordinary authentication error handling", () => {
    expect(databaseFailure(new Error("Invalid login token"))).toBeNull();
  });
});
