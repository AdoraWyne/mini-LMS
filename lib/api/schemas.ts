import { z } from "zod";

// All objects are z.strictObject: unknown keys are a 400, never silently dropped
// (decision 8; see docs on mass assignment / strong params).

/** Text field: trimmed first, so whitespace-only fails and length excludes surrounding spaces. */
function trimmedText(label: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
}

/**
 * A NEW consultation time: ISO 8601 with an offset (decision 10), and in the future.
 * Checked with the server clock at request time; the DB trigger re-checks with now().
 */
const futureDateTime = z.iso
  .datetime({ offset: true, error: "Must be a date-time with a timezone offset" })
  .refine((value) => new Date(value).getTime() > Date.now(), "Must be in the future");

export const createConsultationSchema = z.strictObject({
  firstName: trimmedText("First name", 100),
  lastName: trimmedText("Last name", 100),
  reason: trimmedText("Reason", 1000),
  scheduledAt: futureDateTime,
});
export type CreateConsultationInput = z.infer<typeof createConsultationSchema>;

/** PATCH body: one action = one state transition (decision 9). */
export const patchConsultationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("complete") }),
  z.strictObject({ action: z.literal("uncomplete") }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("reschedule"), scheduledAt: futureDateTime }),
]);
export type PatchConsultationInput = z.infer<typeof patchConsultationSchema>;

/** Path id. A non-UUID is answered with 404 by the route (it's the address, not input). */
export const consultationIdSchema = z.uuid();

/**
 * Admin list query (decision 16). Query-string values arrive as strings, so coerce.
 * `.default()` applies when the param is absent; an empty string ("?page=") is rejected.
 */
export const adminListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
