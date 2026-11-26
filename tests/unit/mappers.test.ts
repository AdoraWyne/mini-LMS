/**
 * Unit tests for lib/api/mappers.ts: the one place DB snake_case becomes API camelCase.
 */
import { describe, expect, it } from "vitest";
import { toConsultationDto } from "@/lib/api/mappers";
import type { Tables } from "@/lib/database.types";

// Postgres/PostgREST returns timestamptz as "+00:00" strings, not "Z".
const row: Tables<"consultations"> = {
  id: "3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  student_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  first_name: "Ada",
  last_name: "Lovelace",
  reason: "Help with my essay",
  scheduled_at: "2026-12-01T10:00:00+00:00",
  status: "scheduled",
  created_at: "2026-11-20T08:30:00.123456+00:00",
  updated_at: "2026-11-21T09:45:00+00:00",
};

describe("toConsultationDto", () => {
  it("maps every column to its camelCase field", () => {
    expect(toConsultationDto(row)).toEqual({
      id: row.id,
      studentId: row.student_id,
      firstName: "Ada",
      lastName: "Lovelace",
      reason: "Help with my essay",
      scheduledAt: "2026-12-01T10:00:00.000Z",
      status: "scheduled",
      createdAt: "2026-11-20T08:30:00.123Z",
      updatedAt: "2026-11-21T09:45:00.000Z",
    });
  });

  it("normalises any offset to ISO UTC (same moment, one format)", () => {
    const dto = toConsultationDto({ ...row, scheduled_at: "2026-12-01T21:00:00+11:00" });
    expect(dto.scheduledAt).toBe("2026-12-01T10:00:00.000Z");
  });

  it("returns no snake_case keys", () => {
    const keys = Object.keys(toConsultationDto(row));
    expect(keys.filter((key) => key.includes("_"))).toEqual([]);
  });
});
