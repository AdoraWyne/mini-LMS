/**
 * Unit tests for lib/client/page-param.ts: reading ?page= from the admin page's URL.
 * A hand-edited URL must never reach the API as an invalid page (which would be a 400).
 */
import { describe, expect, it } from "vitest";
import { parsePageParam } from "@/lib/client/page-param";

describe("parsePageParam", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    ["99", 99],
  ])("reads %j as page %i", (value, page) => {
    expect(parsePageParam(value)).toBe(page);
  });

  it.each([[null], [""], ["abc"], ["0"], ["-1"], ["1.5"], ["2abc"], [" 3"], ["1e3"]])(
    "falls back to page 1 for %j",
    (value) => {
      expect(parsePageParam(value)).toBe(1);
    },
  );
});
