import type { z } from "zod";
import { ApiError, fromZodError, GENERIC_MESSAGE, type ValidationDetails } from "./errors";

/** Every successful response: `{ data }`. */
export type ApiSuccess<T> = { data: T };

/** Every error response: `{ error: { message, details? } }`. */
export type ApiErrorBody = { error: { message: string; details?: ValidationDetails } };

/** A page of a paginated list (the admin route's `data`). Shared with the browser hook. */
export type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

// Standard Response.json (not NextResponse): route handlers can return any Response,
// and these helpers stay plain functions that are easy to unit test.

export function ok<T>(data: T, status = 200): Response {
  const body: ApiSuccess<T> = { data };
  return Response.json(body, { status });
}

export function errorResponse(error: ApiError): Response {
  const body: ApiErrorBody = {
    error: error.details ? { message: error.message, details: error.details } : { message: error.message },
  };
  return Response.json(body, { status: error.status });
}

/** Reads the request body as JSON. Invalid JSON is the client's mistake: 400, not 500. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
}

/** Validates input with a zod schema. Invalid input throws a 400 ApiError with field details. */
export function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}

/**
 * Wraps a route handler so every error leaves the API in the same shape:
 * - ApiError -> its status and message (4xx are expected, so not logged).
 * - Anything else, or a 500 ApiError -> logged server-side, generic 500 to the client.
 *   Internal details (DB messages, stack traces) never reach the response.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status >= 500) console.error("API error:", error.cause ?? error);
        return errorResponse(error);
      }
      console.error("Unexpected API error:", error);
      return errorResponse(new ApiError(500, GENERIC_MESSAGE));
    }
  };
}
