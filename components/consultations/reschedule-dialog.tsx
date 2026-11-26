"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateConsultation } from "@/hooks/use-update-consultation";
import type { ConsultationDto } from "@/lib/api/mappers";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/consultations/datetime";

/**
 * Reschedule: datetime-local pre-filled with the CURRENT time in the viewer's timezone, min = now.
 * The browser converts the local value to UTC (decision 10); the API re-checks "in the future".
 */
export function RescheduleDialog({
  consultation,
  now,
  disabled,
}: {
  consultation: ConsultationDto;
  now: Date;
  disabled: boolean;
}) {
  const current = toDatetimeLocalValue(consultation.scheduledAt);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const mutation = useUpdateConsultation(consultation.id);
  const inputId = `reschedule-${consultation.id}`;

  const newTime = fromDatetimeLocalValue(value);
  // The API rejects an unchanged time (400), so don't let the student send one.
  const unchanged = value === current;
  const fieldError = mutation.error?.details?.fieldErrors.scheduledAt?.[0];

  function onOpenChange(next: boolean) {
    if (mutation.isPending) return;
    if (next) {
      setValue(current); // always start from the booking's current time
      mutation.reset();
    }
    setOpen(next);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!newTime || unchanged) return;
    try {
      await mutation.mutateAsync({ action: "reschedule", scheduledAt: newTime });
      setOpen(false);
    } catch {
      // Shown below (field error or message); the list has been refetched.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Reschedule consultation</DialogTitle>
            <DialogDescription>Pick a new time. Times are in your timezone.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>New date and time</Label>
            <Input
              id={inputId}
              type="datetime-local"
              value={value}
              min={toDatetimeLocalValue(now.toISOString())}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${inputId}-error` : undefined}
              required
            />
            {fieldError && (
              <p id={`${inputId}-error`} className="text-sm text-destructive">
                {fieldError}
              </p>
            )}
          </div>
          {mutation.error && !fieldError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!newTime || unchanged || mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
