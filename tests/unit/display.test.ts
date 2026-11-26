/**
 * Unit tests for lib/consultations/display.ts: what the dashboard shows and allows per row.
 * Mirrors decision 6a (same rules as the API's WHERE clauses and the DB trigger), plus the
 * UI-only label from 6c and "no actions on cancelled rows" from 6d.
 * `now` is injected, so nothing here depends on the real clock.
 */
import { describe, expect, it } from "vitest";
import { availableActions, hasTimePassed, statusLabel } from "@/lib/consultations/display";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const PAST = "2026-11-27T11:00:00.000Z";
const FUTURE = "2026-11-27T13:00:00.000Z";
const EXACTLY_NOW = "2026-11-27T12:00:00.000Z";

const row = (status: "scheduled" | "completed" | "cancelled", scheduledAt: string) => ({ status, scheduledAt });

describe("hasTimePassed", () => {
  it("is true for a past time and false for a future time", () => {
    expect(hasTimePassed(row("scheduled", PAST), NOW)).toBe(true);
    expect(hasTimePassed(row("scheduled", FUTURE), NOW)).toBe(false);
  });

  it("counts exactly now as passed (same boundary as the API: complete needs scheduled_at <= now)", () => {
    expect(hasTimePassed(row("scheduled", EXACTLY_NOW), NOW)).toBe(true);
  });
});

describe("statusLabel (6c, 6d)", () => {
  it.each([
    ["scheduled", FUTURE, "Scheduled"],
    ["scheduled", PAST, "Awaiting completion"],
    ["scheduled", EXACTLY_NOW, "Awaiting completion"],
    ["completed", PAST, "Completed"],
    ["cancelled", FUTURE, "Cancelled"],
    ["cancelled", PAST, "Cancelled"],
  ] as const)("%s at %s -> %j", (status, scheduledAt, label) => {
    expect(statusLabel(row(status, scheduledAt), NOW)).toBe(label);
  });
});

describe("availableActions (6a)", () => {
  it("future scheduled: cancel and reschedule only", () => {
    expect(availableActions(row("scheduled", FUTURE), NOW)).toEqual({
      canComplete: false,
      canUncomplete: false,
      canCancel: true,
      canReschedule: true,
    });
  });

  it("past scheduled ('Awaiting completion'): complete only", () => {
    expect(availableActions(row("scheduled", PAST), NOW)).toEqual({
      canComplete: true,
      canUncomplete: false,
      canCancel: false,
      canReschedule: false,
    });
  });

  it("exactly now counts as passed: complete only", () => {
    expect(availableActions(row("scheduled", EXACTLY_NOW), NOW)).toEqual({
      canComplete: true,
      canUncomplete: false,
      canCancel: false,
      canReschedule: false,
    });
  });

  it("completed: uncomplete only", () => {
    expect(availableActions(row("completed", PAST), NOW)).toEqual({
      canComplete: false,
      canUncomplete: true,
      canCancel: false,
      canReschedule: false,
    });
  });

  it.each([[FUTURE], [PAST]])("cancelled (at %s): no actions at all (6d)", (scheduledAt) => {
    expect(availableActions(row("cancelled", scheduledAt), NOW)).toEqual({
      canComplete: false,
      canUncomplete: false,
      canCancel: false,
      canReschedule: false,
    });
  });
});
