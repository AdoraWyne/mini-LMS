import type { TablesUpdate } from "@/lib/database.types";
import type { ConsultationStatus } from "./mappers";
import type { PatchConsultationInput } from "./schemas";

/**
 * One PATCH action as data: what to change and when it's allowed (decision 6a).
 *
 * The route turns this into ONE atomic UPDATE with the conditions in its WHERE clause
 * (decision 9a), so there's no check-then-update race.
 *
 * KEEP IN SYNC with the business-rule trigger in the migration (the DB backstop).
 */
export type Transition = {
  /** Only the columns the grants allow (status, scheduled_at). updated_at is set by a trigger. */
  set: Pick<TablesUpdate<"consultations">, "status" | "scheduled_at">;
  /** The row must currently have this status. */
  requiredStatus: ConsultationStatus;
  /**
   * Compare the row's CURRENT scheduled_at with `now`:
   * "lte" = the time has passed, "gt" = still upcoming, null = no time rule.
   * `now` is the Next.js server clock (PostgREST filters can't call the DB's now());
   * the trigger re-checks with the DB clock.
   */
  scheduledAtCondition: { operator: "lte" | "gt"; value: string } | null;
  /** Returned with a 409 when the row is yours but the conditions don't hold. */
  conflictMessage: string;
};

export function transitionFor(input: PatchConsultationInput, now: Date): Transition {
  const nowIso = now.toISOString();

  switch (input.action) {
    case "complete":
      return {
        set: { status: "completed" },
        requiredStatus: "scheduled",
        scheduledAtCondition: { operator: "lte", value: nowIso },
        conflictMessage: "Only past consultations that are still scheduled can be completed",
      };
    case "uncomplete":
      return {
        set: { status: "scheduled" },
        requiredStatus: "completed",
        scheduledAtCondition: null,
        conflictMessage: "Only completed consultations can be marked incomplete",
      };
    case "cancel":
      return {
        set: { status: "cancelled" },
        requiredStatus: "scheduled",
        scheduledAtCondition: { operator: "gt", value: nowIso },
        conflictMessage: "Only upcoming scheduled consultations can be cancelled",
      };
    case "reschedule":
      return {
        // The NEW time was already checked by zod (future, with offset).
        set: { scheduled_at: new Date(input.scheduledAt).toISOString() },
        requiredStatus: "scheduled",
        scheduledAtCondition: { operator: "gt", value: nowIso },
        conflictMessage: "Only upcoming scheduled consultations can be rescheduled",
      };
  }
}
