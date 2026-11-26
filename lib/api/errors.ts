import { z } from "zod";

/** Shape of `error.details` for validation errors (zod's flattened format). */
export type ValidationDetails = {
  /** Errors not tied to one field, e.g. unknown keys. */
  formErrors: string[];
  /** Per-field messages, e.g. { firstName: ["Too long"] }. The form shows these next to each field. */
  fieldErrors: Partial<Record<string, string[]>>;
};

/**
 * An error the API knows how to answer. Route code throws these;
 * withErrorHandling() (lib/api/http.ts) turns them into `{ error: { message, details? } }`.
 *
 * `cause` is for server-side logging only and is never sent to the client.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ValidationDetails,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

/** The only message a client ever sees for a 500. */
export const GENERIC_MESSAGE = "Something went wrong";

/** The fields we read from a supabase-js / PostgREST error. */
type DbError = { code?: string; message: string };

/**
 * Maps a database error to an ApiError. Pure: no logging here (that happens at the
 * boundary, in withErrorHandling).
 *
 * - LM400 / LM409: our business-rule trigger (see the migration). Its messages are
 *   written for users, so they're safe to return.
 * - Anything else (e.g. 42501 permission denied, 23514 CHECK failed): through our API
 *   these only happen if zod and the DB disagree, i.e. a bug on our side, not bad input.
 *   Return a generic 500 and keep the original as `cause` for the server log.
 */
export function mapDbError(error: DbError): ApiError {
  switch (error.code) {
    case "LM400":
      return new ApiError(400, error.message);
    case "LM409":
      return new ApiError(409, error.message);
    default:
      return new ApiError(500, GENERIC_MESSAGE, undefined, { cause: error });
  }
}

/** A failed zod parse becomes a 400 with per-field messages the UI can show. */
export function fromZodError(error: z.ZodError): ApiError {
  return new ApiError(400, "Invalid input", z.flattenError(error));
}

