import type { ConsultationDto } from "@/lib/api/mappers";

/**
 * What the dashboard shows and allows for one consultation. Pure: `now` is passed in,
 * so components stay pure and these rules are unit-tested.
 *
 * Mirrors decision 6a. The same rules live in lib/api/transitions.ts (the API's WHERE
 * clauses) and in the DB trigger. The UI version only decides what to SHOW: if it were
 * wrong, the API would still answer 409.
 */

type ConsultationTiming = Pick<ConsultationDto, "status" | "scheduledAt">;

export type StatusLabel = "Scheduled" | "Awaiting completion" | "Completed" | "Cancelled";

export type AvailableActions = {
  canComplete: boolean;
  canUncomplete: boolean;
  canCancel: boolean;
  canReschedule: boolean;
};

/** Hint next to the disabled complete checkbox (decision 6b). */
export const COMPLETE_HINT = "Available after the consultation time";

/** Exactly "now" counts as passed, the same boundary as the API (complete needs scheduled_at <= now). */
export function hasTimePassed(consultation: ConsultationTiming, now: Date): boolean {
  return new Date(consultation.scheduledAt).getTime() <= now.getTime();
}

/** UI-only label (decision 6c): a past "scheduled" consultation is "Awaiting completion". */
export function statusLabel(consultation: ConsultationTiming, now: Date): StatusLabel {
  switch (consultation.status) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "scheduled":
      return hasTimePassed(consultation, now) ? "Awaiting completion" : "Scheduled";
  }
}

export function availableActions(consultation: ConsultationTiming, now: Date): AvailableActions {
  const passed = hasTimePassed(consultation, now);
  const scheduled = consultation.status === "scheduled";
  return {
    canComplete: scheduled && passed,
    canUncomplete: consultation.status === "completed",
    canCancel: scheduled && !passed,
    canReschedule: scheduled && !passed,
  };
}
