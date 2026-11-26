"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConsultationDto } from "@/lib/api/mappers";
import type { PatchConsultationInput } from "@/lib/api/schemas";
import { apiClient, type ApiClientError } from "@/lib/client/api-client";
import { consultationKeys } from "./use-consultations";

/**
 * PATCH /api/consultations/[id] with one action (decision 9). One hook instance per control,
 * so each control has its own pending/error state.
 *
 * onSettled (success OR error) invalidates every consultation query: after a 409 (e.g. another
 * tab already cancelled it) the list refetches and shows the server's true state.
 * No optimistic updates: the UI waits for the server's answer.
 */
export function useUpdateConsultation(id: string) {
  const queryClient = useQueryClient();
  return useMutation<ConsultationDto, ApiClientError, PatchConsultationInput>({
    mutationFn: (body) => apiClient.patch<ConsultationDto>(`/api/consultations/${id}`, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: consultationKeys.all }),
  });
}
