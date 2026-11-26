/**
 * Unit tests for lib/api/schemas.ts (zod 4). Journeys: docs/user-journeys.md sections 2, 4, 5, 6.
 *
 * Time-sensitive cases use far-past (year 2000) and far-future (year 2999) dates,
 * so "must be in the future" can never flip while the tests run.
 */
import { describe, expect, it } from "vitest";
import {
  adminListQuerySchema,
  consultationIdSchema,
  createConsultationSchema,
  patchConsultationSchema,
} from "@/lib/api/schemas";

const FAR_FUTURE = "2999-01-01T10:00:00.000Z";
const FAR_PAST = "2000-01-01T10:00:00.000Z";

const validBooking = {
  firstName: "Ada",
  lastName: "Lovelace",
  reason: "Help with my essay",
  scheduledAt: FAR_FUTURE,
};

describe("createConsultationSchema (POST /api/consultations)", () => {
  it("accepts a valid booking", () => {
    expect(createConsultationSchema.parse(validBooking)).toEqual(validBooking);
  });

  it("trims text fields, so saved values have no surrounding spaces", () => {
    const result = createConsultationSchema.parse({
      ...validBooking,
      firstName: "  Ada ",
      lastName: " Lovelace  ",
      reason: "  Help  ",
    });
    expect(result).toMatchObject({ firstName: "Ada", lastName: "Lovelace", reason: "Help" });
  });

  it.each(["firstName", "lastName", "reason", "scheduledAt"])("rejects a missing %s", (field) => {
    const body: Record<string, unknown> = { ...validBooking };
    delete body[field];
    expect(createConsultationSchema.safeParse(body).success).toBe(false);
  });

  it.each(["firstName", "lastName", "reason"])("rejects an empty or whitespace-only %s", (field) => {
    expect(createConsultationSchema.safeParse({ ...validBooking, [field]: "" }).success).toBe(false);
    expect(createConsultationSchema.safeParse({ ...validBooking, [field]: "   " }).success).toBe(false);
  });

  it("accepts names up to 100 characters and rejects 101", () => {
    const ok = createConsultationSchema.safeParse({ ...validBooking, firstName: "a".repeat(100) });
    const tooLong = createConsultationSchema.safeParse({ ...validBooking, lastName: "a".repeat(101) });
    expect(ok.success).toBe(true);
    expect(tooLong.success).toBe(false);
  });

  it("accepts a reason up to 1000 characters and rejects 1001", () => {
    expect(createConsultationSchema.safeParse({ ...validBooking, reason: "a".repeat(1000) }).success).toBe(true);
    expect(createConsultationSchema.safeParse({ ...validBooking, reason: "a".repeat(1001) }).success).toBe(false);
  });

  it("checks length after trimming (spaces don't count towards the limit)", () => {
    const padded = `  ${"a".repeat(100)}  `;
    expect(createConsultationSchema.safeParse({ ...validBooking, firstName: padded }).success).toBe(true);
  });

  it.each([["studentId"], ["student_id"], ["status"], ["id"]])(
    "rejects the unknown key %s (strict object, no mass assignment)",
    (key) => {
      const result = createConsultationSchema.safeParse({ ...validBooking, [key]: "x" });
      expect(result.success).toBe(false);
    },
  );

  it("rejects scheduledAt without a timezone offset", () => {
    const result = createConsultationSchema.safeParse({ ...validBooking, scheduledAt: "2999-01-01T10:00" });
    expect(result.success).toBe(false);
  });

  it("accepts scheduledAt with a non-UTC offset", () => {
    const result = createConsultationSchema.safeParse({
      ...validBooking,
      scheduledAt: "2999-01-01T10:00:00+11:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a scheduledAt that isn't a date", () => {
    expect(createConsultationSchema.safeParse({ ...validBooking, scheduledAt: "tomorrow" }).success).toBe(false);
  });

  it("rejects a scheduledAt in the past", () => {
    const result = createConsultationSchema.safeParse({ ...validBooking, scheduledAt: FAR_PAST });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["scheduledAt"]);
  });
});

describe("patchConsultationSchema (PATCH /api/consultations/[id])", () => {
  it.each([[{ action: "complete" }], [{ action: "uncomplete" }], [{ action: "cancel" }]])(
    "accepts %j",
    (body) => {
      expect(patchConsultationSchema.parse(body)).toEqual(body);
    },
  );

  it("accepts reschedule with a future scheduledAt", () => {
    const body = { action: "reschedule", scheduledAt: FAR_FUTURE };
    expect(patchConsultationSchema.parse(body)).toEqual(body);
  });

  it("rejects reschedule without scheduledAt", () => {
    expect(patchConsultationSchema.safeParse({ action: "reschedule" }).success).toBe(false);
  });

  it("rejects reschedule to a past time", () => {
    const result = patchConsultationSchema.safeParse({ action: "reschedule", scheduledAt: FAR_PAST });
    expect(result.success).toBe(false);
  });

  it("rejects reschedule without a timezone offset", () => {
    const result = patchConsultationSchema.safeParse({ action: "reschedule", scheduledAt: "2999-01-01T10:00" });
    expect(result.success).toBe(false);
  });

  it.each([[{ action: "delete" }], [{ action: "" }], [{}], [{ status: "completed" }]])(
    "rejects %j (unknown or missing action)",
    (body) => {
      expect(patchConsultationSchema.safeParse(body).success).toBe(false);
    },
  );

  it.each([
    [{ action: "cancel", status: "completed" }],
    [{ action: "complete", scheduledAt: FAR_FUTURE }],
    [{ action: "reschedule", scheduledAt: FAR_FUTURE, reason: "x" }],
  ])("rejects extra keys: %j", (body) => {
    expect(patchConsultationSchema.safeParse(body).success).toBe(false);
  });
});

describe("consultationIdSchema (path id)", () => {
  it("accepts a UUID", () => {
    const id = "3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    expect(consultationIdSchema.parse(id)).toBe(id);
  });

  it.each(["abc", "", "123", "3f2b8c4e-1a2b-4c3d-8e9f"])("rejects %j", (id) => {
    expect(consultationIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("adminListQuerySchema (GET /api/admin/consultations)", () => {
  it("defaults to page 1, pageSize 20", () => {
    expect(adminListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("converts query-string values to numbers", () => {
    expect(adminListQuerySchema.parse({ page: "3", pageSize: "50" })).toEqual({ page: 3, pageSize: 50 });
  });

  it("accepts pageSize 1 and 100", () => {
    expect(adminListQuerySchema.parse({ pageSize: "1" }).pageSize).toBe(1);
    expect(adminListQuerySchema.parse({ pageSize: "100" }).pageSize).toBe(100);
  });

  it.each([
    [{ pageSize: "1000" }],
    [{ pageSize: "101" }],
    [{ pageSize: "0" }],
    [{ page: "0" }],
    [{ page: "-1" }],
    [{ page: "1.5" }],
    [{ page: "abc" }],
    [{ page: "" }],
  ])("rejects %j", (query) => {
    expect(adminListQuerySchema.safeParse(query).success).toBe(false);
  });

  it("rejects unknown query params (strict, same rule as bodies)", () => {
    expect(adminListQuerySchema.safeParse({ page: "1", sort: "reason" }).success).toBe(false);
  });
});
