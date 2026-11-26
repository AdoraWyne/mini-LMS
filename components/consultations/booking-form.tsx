"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateConsultation } from "@/hooks/use-create-consultation";
import { useNow } from "@/hooks/use-now";
import type { ValidationDetails } from "@/lib/api/errors";
import { createConsultationSchema, FIELD_LIMITS } from "@/lib/api/schemas";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/consultations/datetime";

type TextFieldName = keyof typeof FIELD_LIMITS;
type FieldName = TextFieldName | "scheduledAt";

const EMPTY = { firstName: "", lastName: "", reason: "", scheduledAt: "" };

/**
 * Booking form (journeys section 2). Validates with the SAME zod schema as the API
 * (lib/api/schemas.ts) before sending, for instant feedback. The server validates again:
 * the client check is UX only. Both produce the same { formErrors, fieldErrors } shape.
 */
export function BookingForm() {
  const router = useRouter();
  const now = useNow();
  const mutation = useCreateConsultation();
  const [values, setValues] = useState(EMPTY);
  const [clientErrors, setClientErrors] = useState<ValidationDetails | null>(null);

  // Client errors (from the last submit attempt) win; otherwise show what the server said.
  const details = clientErrors ?? mutation.error?.details;
  const fieldError = (name: FieldName) => details?.fieldErrors[name]?.[0];
  const topMessage = clientErrors ? "Please fix the fields below." : mutation.error?.message;
  // Keep the button disabled after success too, until the redirect lands: no double booking.
  const submitting = mutation.isPending || mutation.isSuccess;

  function update(name: FieldName, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return; // guard against double submit (Enter twice, fast clicks)

    // datetime-local (viewer's wall-clock time) -> UTC ISO (decision 10). null if empty/invalid.
    const scheduledAt = fromDatetimeLocalValue(values.scheduledAt);

    // Always run the whole schema, so every field's error shows at once (not one at a time).
    const parsed = createConsultationSchema.safeParse({ ...values, scheduledAt: scheduledAt ?? "" });
    if (!parsed.success) {
      const errors = z.flattenError(parsed.error);
      // A missing date would otherwise get zod's format message; this one is clearer for a picker.
      if (!scheduledAt) errors.fieldErrors.scheduledAt = ["Pick a date and time"];
      setClientErrors(errors);
      return;
    }

    setClientErrors(null);
    // parsed.data is trimmed, the same values the server would save.
    mutation.mutate(parsed.data, { onSuccess: () => router.push("/dashboard?booked=1") });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      {topMessage && (
        <div role="alert" className="rounded-md border border-destructive px-4 py-3 text-sm text-destructive">
          <p>{topMessage}</p>
          {details?.formErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <TextField name="firstName" label="First name" value={values.firstName} error={fieldError("firstName")} onChange={update} />
      <TextField name="lastName" label="Last name" value={values.lastName} error={fieldError("lastName")} onChange={update} />
      <TextField name="reason" label="Reason for consultation" value={values.reason} error={fieldError("reason")} onChange={update} multiline />

      <div className="flex flex-col gap-2">
        <Label htmlFor="scheduledAt">Date and time</Label>
        <Input
          id="scheduledAt"
          type="datetime-local"
          value={values.scheduledAt}
          // UX only (blocks past picks in the picker); zod and the server still check.
          // `now` is null until mounted (see hooks/use-now.ts).
          min={now ? toDatetimeLocalValue(now.toISOString()) : undefined}
          onChange={(event) => update("scheduledAt", event.target.value)}
          aria-invalid={fieldError("scheduledAt") ? true : undefined}
          aria-describedby={fieldError("scheduledAt") ? "scheduledAt-error" : "scheduledAt-help"}
        />
        {fieldError("scheduledAt") ? (
          <p id="scheduledAt-error" className="text-sm text-destructive">
            {fieldError("scheduledAt")}
          </p>
        ) : (
          <p id="scheduledAt-help" className="text-xs text-muted-foreground">
            In your timezone.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Booking…" : "Book consultation"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </form>
  );
}

/** A text input/textarea with label, trimmed-length counter (e.g. 87/100) and field error. */
function TextField({
  name,
  label,
  value,
  error,
  onChange,
  multiline = false,
}: {
  name: TextFieldName;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (name: TextFieldName, value: string) => void;
  multiline?: boolean;
}) {
  const max = FIELD_LIMITS[name];
  // Counts the TRIMMED length, like the server (which trims before checking). No hard maxLength:
  // it would count surrounding spaces and could block input the server accepts.
  const length = value.trim().length;
  const over = length > max;
  const counterId = `${name}-counter`;
  const errorId = `${name}-error`;
  const describedBy = error ? `${errorId} ${counterId}` : counterId;
  const Control = multiline ? Textarea : Input;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Control
        id={name}
        value={value}
        onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onChange(name, event.target.value)}
        aria-invalid={error || over ? true : undefined}
        aria-describedby={describedBy}
        rows={multiline ? 4 : undefined}
      />
      <div className="flex justify-between gap-4 text-xs">
        <span id={errorId} className="text-destructive">
          {error}
        </span>
        <span id={counterId} className={over ? "text-destructive" : "text-muted-foreground"}>
          {length}/{max}
        </span>
      </div>
    </div>
  );
}
