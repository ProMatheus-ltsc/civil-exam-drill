import { describe, expect, it } from "vitest";
import { loadEntries } from "../scripts/content/lib.mjs";
import sanitizeHtml from "sanitize-html";
import { marked } from "marked";

describe("knowledge HTML security", () => {
  it("keeps generated knowledge free of executable markup", async () => {
    const { entries, errors } = await loadEntries();
    expect(errors).toEqual([]);
    for (const entry of entries) {
      expect(entry.html).not.toMatch(
        /<script|\son\w+=|javascript:|data:text\/html/i,
      );
    }
  });

  it("removes dangerous Markdown link protocols", () => {
    const unsafe = marked.parse("[click](javascript:alert(1))", {
      async: false,
    });
    const safe = sanitizeHtml(unsafe, {
      allowedTags: ["p", "a"],
      allowedAttributes: { a: ["href"] },
      allowedSchemes: ["http", "https", "mailto"],
      allowProtocolRelative: false,
    });
    expect(safe).not.toContain("javascript:");
  });

});
