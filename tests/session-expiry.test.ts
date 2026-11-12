import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../functions/api/[[path]].ts", import.meta.url),
  "utf8",
).replace(/\s+/g, "");

describe("session expiry", () => {
  it("uses julianday instead of CURRENT_TIMESTAMP", () => {
    expect(source).toContain("julianday(s.expires_at)>julianday('now')");
    expect(source).toContain("julianday(expires_at)<=julianday('now')");
  });
});
