"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConsultationDto } from "@/lib/api/mappers";
import type { CreateConsultationInput } from "@/lib/api/schemas";
import { apiClient, type ApiClientError } from "@/lib/client/api-client";
import { consultationKeys } from "./use-consultations";

/** POST /api/consultations. student_id comes from the session on the server, never from here. */
export function useCreateConsultation() {
  const queryClient = useQueryClient();
  return useMutation<ConsultationDto, ApiClientError, CreateConsultationInput>({
    mutationFn: (body) => apiClient.post<ConsultationDto>("/api/consultations", body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: consultationKeys.all }),
  });
}
