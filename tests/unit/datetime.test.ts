/**
 * Unit tests for lib/consultations/datetime.ts: converting between a <input type="datetime-local">
 * value (the viewer's local wall-clock time, no offset) and a UTC ISO string (decision 10).
 *
 * These run in Australia/Sydney (set by the npm `test` script), NOT UTC. In UTC, local time
 * and UTC look identical, so a conversion bug (e.g. using getUTCHours() instead of getHours())
 * would pass silently. Sydney also has daylight saving: UTC+11 in summer, UTC+10 in winter.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/consultations/datetime";

beforeAll(() => {
  // Fail loudly if run without the npm script (e.g. `npx vitest`): in UTC these tests
  // would pass even with broken code, which is worse than failing.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone !== "Australia/Sydney") {
    throw new Error(`datetime tests must run with TZ=Australia/Sydney (got ${zone}). Use \`npm test\`.`);
  }
});

describe("toDatetimeLocalValue (UTC ISO -> local input value)", () => {
  it("converts to Sydney summer time (UTC+11)", () => {
    expect(toDatetimeLocalValue("2026-12-01T10:00:00.000Z")).toBe("2026-12-01T21:00");
  });

  it("converts to Sydney winter time (UTC+10)", () => {
    expect(toDatetimeLocalValue("2026-07-01T10:00:00.000Z")).toBe("2026-07-01T20:00");
  });

  it("crosses midnight into the next local day", () => {
    expect(toDatetimeLocalValue("2026-12-31T14:30:00.000Z")).toBe("2027-01-01T01:30");
  });

  it("pads single-digit months, days, hours and minutes", () => {
    expect(toDatetimeLocalValue("2026-02-03T20:05:00.000Z")).toBe("2026-02-04T07:05");
  });

  it("drops seconds and milliseconds (datetime-local is minute precision)", () => {
    expect(toDatetimeLocalValue("2026-12-01T10:00:59.999Z")).toBe("2026-12-01T21:00");
  });
});

describe("fromDatetimeLocalValue (local input value -> UTC ISO)", () => {
  it("treats the value as Sydney local time (summer, UTC+11)", () => {
    expect(fromDatetimeLocalValue("2026-12-01T21:00")).toBe("2026-12-01T10:00:00.000Z");
  });

  it("treats the value as Sydney local time (winter, UTC+10)", () => {
    expect(fromDatetimeLocalValue("2026-07-01T20:00")).toBe("2026-07-01T10:00:00.000Z");
  });

  it("round-trips with toDatetimeLocalValue", () => {
    const iso = "2026-12-01T10:00:00.000Z";
    expect(fromDatetimeLocalValue(toDatetimeLocalValue(iso))).toBe(iso);
  });

  it("turns a time skipped by daylight saving into a real moment (journeys section 8)", () => {
    // Sydney clocks jump 02:00 -> 03:00 on 4 Oct 2026, so 02:30 doesn't exist locally.
    // The browser/JS moves it forward to 03:30 AEDT (UTC+11) = 16:30 UTC the day before.
    expect(fromDatetimeLocalValue("2026-10-04T02:30")).toBe("2026-10-03T16:30:00.000Z");
  });

  it.each([[""], ["not a date"], ["2026-13-01T10:00"]])("returns null for an invalid value %j", (value) => {
    expect(fromDatetimeLocalValue(value)).toBeNull();
  });
});
