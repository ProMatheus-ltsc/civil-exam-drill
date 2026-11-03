import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { modules } from "../scripts/content/lib.mjs";

const API_FILE = fileURLToPath(new URL("../functions/api/[[path]].ts", import.meta.url));

describe("模块枚举一致性", () => {
  it("API 的 module 枚举与 lib.mjs 的 modules 一致", async () => {
    const source = await readFile(API_FILE, "utf-8");
    const enumMatch = source.match(
      /module:\s*z\s*\.enum\(\s*\[([\s\S]*?)\]\s*\)/,
    );
    expect(enumMatch, "未能在 API 源码里定位 module 枚举").toBeTruthy();
    const apiModules = [...enumMatch![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(apiModules.sort()).toEqual([...modules].sort());
  });
});
