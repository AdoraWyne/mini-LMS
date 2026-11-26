"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useUpdateConsultation } from "@/hooks/use-update-consultation";
import type { ConsultationDto } from "@/lib/api/mappers";
import { availableActions, COMPLETE_HINT } from "@/lib/consultations/display";
import { CancelDialog } from "./cancel-dialog";
import { RescheduleDialog } from "./reschedule-dialog";

/**
 * Per-row controls. What's shown comes from availableActions() (decision 6a, unit-tested);
 * the API decides for real (a stale UI just gets a 409 and a refetch).
 */
export function RowActions({ consultation, now }: { consultation: ConsultationDto; now: Date }) {
  const toggle = useUpdateConsultation(consultation.id);

  // 6d: cancelled rows have no actions at all.
  if (consultation.status === "cancelled") return null;

  const actions = availableActions(consultation, now);
  const isCompleted = consultation.status === "completed";
  const canToggle = actions.canComplete || actions.canUncomplete;
  const pending = toggle.isPending;

  // 6b: a future booking can't be completed yet. The hint is visible text, not a tooltip:
  // disabled elements don't fire hover events, and screen readers get it via aria-describedby.
  const showHint = !canToggle && consultation.status === "scheduled";
  const hintId = `complete-hint-${consultation.id}`;
  const when = new Date(consultation.scheduledAt).toLocaleString();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isCompleted}
            disabled={!canToggle || pending}
            onCheckedChange={(checked) => toggle.mutate({ action: checked === true ? "complete" : "uncomplete" })}
            aria-label={`Mark the consultation on ${when} as completed`}
            aria-describedby={showHint ? hintId : undefined}
          />
          {showHint && (
            <span id={hintId} className="text-xs text-muted-foreground">
              {COMPLETE_HINT}
            </span>
          )}
        </div>
        {actions.canReschedule && <RescheduleDialog consultation={consultation} now={now} disabled={pending} />}
        {actions.canCancel && <CancelDialog consultation={consultation} disabled={pending} />}
      </div>
      {toggle.error && (
        <p role="alert" className="text-xs text-destructive">
          {toggle.error.message}
        </p>
      )}
    </div>
  );
}
