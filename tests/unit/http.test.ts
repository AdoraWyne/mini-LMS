/**
 * Unit tests for lib/api/http.ts: one success shape `{ data }`, one error shape
 * `{ error: { message, details? } }` for the whole API (CLAUDE.md "Status codes").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { errorResponse, ok, parseInput, parseJsonBody, withErrorHandling } from "@/lib/api/http";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("ok", () => {
  it("wraps data in { data } with status 200 by default", async () => {
    const response = ok({ id: "1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ data: { id: "1" } });
  });

  it("uses the given status (e.g. 201 Created)", async () => {
    const response = ok([], 201);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: [] });
  });
});

describe("errorResponse", () => {
  it("returns { error: { message } } with the error's status", async () => {
    const response = errorResponse(new ApiError(404, "Consultation not found"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { message: "Consultation not found" } });
  });

  it("includes details when present", async () => {
    const details = { formErrors: [], fieldErrors: { reason: ["Required"] } };
    const response = errorResponse(new ApiError(400, "Invalid input", details));
    expect(await response.json()).toEqual({ error: { message: "Invalid input", details } });
  });
});

describe("parseJsonBody", () => {
  it("returns the parsed JSON", async () => {
    expect(await parseJsonBody(jsonRequest('{"action":"cancel"}'))).toEqual({ action: "cancel" });
  });

  it.each(["{not json", "", "{\"a\":"])("throws a 400 ApiError for invalid JSON: %j", async (body) => {
    await expect(parseJsonBody(jsonRequest(body))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be valid JSON",
    });
  });
});

describe("parseInput", () => {
  const schema = z.strictObject({ name: z.string().min(1) });

  it("returns the parsed value when valid", () => {
    expect(parseInput(schema, { name: "Ada" })).toEqual({ name: "Ada" });
  });

  it("throws a 400 ApiError with details when invalid", () => {
    expect(() => parseInput(schema, { name: "" })).toThrow(ApiError);
    try {
      parseInput(schema, { name: "" });
    } catch (error) {
      expect(error).toMatchObject({ status: 400, message: "Invalid input" });
      expect((error as ApiError).details?.fieldErrors.name).toBeDefined();
    }
  });
});

describe("withErrorHandling", () => {
  it("passes a successful response through unchanged", async () => {
    const handler = withErrorHandling(async () => ok({ fine: true }));
    const response = await handler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { fine: true } });
  });

  it("passes the handler's arguments through", async () => {
    const handler = withErrorHandling(async (request: Request) => ok({ method: request.method }));
    const response = await handler(jsonRequest("{}"));
    expect(await response.json()).toEqual({ data: { method: "POST" } });
  });

  it("turns a thrown ApiError into its status and error body", async () => {
    const handler = withErrorHandling(async () => {
      throw new ApiError(409, "Only upcoming consultations can be cancelled");
    });
    const response = await handler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { message: "Only upcoming consultations can be cancelled" },
    });
  });

  it("turns an unexpected exception into a generic 500, logging it server-side only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new Error("secret internal detail: connection string xyz");
    });
    const response = await handler();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { message: "Something went wrong" } });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(log).toHaveBeenCalled();
  });

  it("logs the cause of a 500 ApiError (e.g. a mapped DB error) without returning it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = { code: "42501", message: "permission denied for table consultations" };
    const handler = withErrorHandling(async () => {
      throw new ApiError(500, "Something went wrong", undefined, { cause });
    });
    const response = await handler();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("permission denied");
    expect(log).toHaveBeenCalledWith(expect.any(String), cause);
  });

  it("does not log expected errors (4xx)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new ApiError(404, "Consultation not found");
    });
    await handler();
    expect(log).not.toHaveBeenCalled();
  });
});
