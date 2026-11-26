"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUpdateConsultation } from "@/hooks/use-update-consultation";
import type { ConsultationDto } from "@/lib/api/mappers";

/**
 * Soft cancel (decision 5) behind a confirmation. Controlled `open`: the dialog stays open
 * while the request runs and if it fails, and closes only on success. (Radix's
 * AlertDialogAction would close on click, hiding the pending state and any error.)
 */
export function CancelDialog({ consultation, disabled }: { consultation: ConsultationDto; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const mutation = useUpdateConsultation(consultation.id);

  function onOpenChange(next: boolean) {
    if (mutation.isPending) return; // don't close mid-request
    if (next) mutation.reset(); // fresh dialog: no error from a previous attempt
    setOpen(next);
  }

  async function confirm() {
    try {
      await mutation.mutateAsync({ action: "cancel" });
      setOpen(false);
    } catch {
      // The error is shown in the dialog (mutation.error); the list has been refetched.
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this consultation?</AlertDialogTitle>
          <AlertDialogDescription>
            {new Date(consultation.scheduledAt).toLocaleString()} with {consultation.firstName}{" "}
            {consultation.lastName}. It stays in your list as cancelled and can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Keep it</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={mutation.isPending}>
            {mutation.isPending ? "Cancelling…" : "Cancel consultation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
