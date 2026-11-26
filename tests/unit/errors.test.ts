/**
 * Unit tests for lib/api/errors.ts: turning DB and zod errors into API errors.
 * Status-code rules: CLAUDE.md "Status codes". Unexpected errors never leak details.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, fromZodError, mapDbError } from "@/lib/api/errors";

describe("ApiError", () => {
  it("carries a status, a message and optional details", () => {
    const error = new ApiError(404, "Consultation not found");
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Consultation not found");
    expect(error.details).toBeUndefined();
  });
});

describe("mapDbError", () => {
  it("maps trigger code LM400 to 400 and keeps the trigger's message", () => {
    const error = mapDbError({ code: "LM400", message: "Consultation time must be in the future" });
    expect(error.status).toBe(400);
    expect(error.message).toBe("Consultation time must be in the future");
  });

  it("maps trigger code LM409 to 409 and keeps the trigger's message", () => {
    const error = mapDbError({ code: "LM409", message: "Only upcoming consultations can be cancelled" });
    expect(error.status).toBe(409);
    expect(error.message).toBe("Only upcoming consultations can be cancelled");
  });

  it.each([
    ["42501", 'permission denied for table consultations'],
    ["23514", 'new row violates check constraint "consultations_first_name_check"'],
    ["08006", "connection failure"],
    [undefined, "something odd"],
  ])("maps %s to a generic 500 without leaking the DB message", (code, message) => {
    const dbError = { code, message };
    const error = mapDbError(dbError);
    expect(error.status).toBe(500);
    expect(error.message).toBe("Something went wrong");
    expect(error.message).not.toContain(message);
    // The original error is kept as `cause`, for server-side logging only.
    expect(error.cause).toBe(dbError);
  });
});

describe("fromZodError", () => {
  it("returns a 400 with flattened field errors as details", () => {
    const schema = z.strictObject({ firstName: z.string().min(1, "First name is required") });
    const result = schema.safeParse({ firstName: "" });
    if (result.success) throw new Error("expected the parse to fail");

    const error = fromZodError(result.error);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Invalid input");
    expect(error.details).toEqual({
      formErrors: [],
      fieldErrors: { firstName: ["First name is required"] },
    });
  });

  it("reports unknown keys as form-level errors", () => {
    const schema = z.strictObject({ firstName: z.string() });
    const result = schema.safeParse({ firstName: "Ada", studentId: "x" });
    if (result.success) throw new Error("expected the parse to fail");

    const error = fromZodError(result.error);
    expect(error.details?.formErrors.length).toBeGreaterThan(0);
  });
});
