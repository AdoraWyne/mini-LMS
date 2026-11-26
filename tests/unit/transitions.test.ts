/**
 * Unit tests for lib/api/transitions.ts: the decision 6a table as data.
 * Each PATCH action -> what to set + the "allowed when" WHERE conditions + the 409 message.
 * `now` is injected, so nothing here depends on the real clock.
 */
import { describe, expect, it } from "vitest";
import { transitionFor } from "@/lib/api/transitions";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const NOW_ISO = "2026-11-27T12:00:00.000Z";

describe("transitionFor", () => {
  it("complete: scheduled -> completed, only once the time has passed (scheduled_at <= now)", () => {
    expect(transitionFor({ action: "complete" }, NOW)).toEqual({
      set: { status: "completed" },
      requiredStatus: "scheduled",
      scheduledAtCondition: { operator: "lte", value: NOW_ISO },
      conflictMessage: "Only past consultations that are still scheduled can be completed",
    });
  });

  it("uncomplete: completed -> scheduled, no time condition", () => {
    expect(transitionFor({ action: "uncomplete" }, NOW)).toEqual({
      set: { status: "scheduled" },
      requiredStatus: "completed",
      scheduledAtCondition: null,
      conflictMessage: "Only completed consultations can be marked incomplete",
    });
  });

  it("cancel: scheduled -> cancelled, only while upcoming (scheduled_at > now)", () => {
    expect(transitionFor({ action: "cancel" }, NOW)).toEqual({
      set: { status: "cancelled" },
      requiredStatus: "scheduled",
      scheduledAtCondition: { operator: "gt", value: NOW_ISO },
      conflictMessage: "Only upcoming scheduled consultations can be cancelled",
    });
  });

  it("reschedule: sets only the new time, only while upcoming (scheduled_at > now)", () => {
    const newTime = "2999-01-01T10:00:00.000Z";
    expect(transitionFor({ action: "reschedule", scheduledAt: newTime }, NOW)).toEqual({
      set: { scheduled_at: newTime },
      requiredStatus: "scheduled",
      scheduledAtCondition: { operator: "gt", value: NOW_ISO },
      conflictMessage: "Only upcoming scheduled consultations can be rescheduled",
    });
  });

  it("reschedule normalises the new time to ISO UTC", () => {
    const transition = transitionFor({ action: "reschedule", scheduledAt: "2999-01-01T21:00:00+11:00" }, NOW);
    expect(transition.set).toEqual({ scheduled_at: "2999-01-01T10:00:00.000Z" });
  });

  it("never sets anything except status or scheduled_at (the columns the grants allow)", () => {
    const actions = [
      { action: "complete" },
      { action: "uncomplete" },
      { action: "cancel" },
      { action: "reschedule", scheduledAt: "2999-01-01T10:00:00.000Z" },
    ] as const;
    for (const input of actions) {
      const keys = Object.keys(transitionFor(input, NOW).set);
      expect(keys.every((key) => key === "status" || key === "scheduled_at")).toBe(true);
    }
  });
});
