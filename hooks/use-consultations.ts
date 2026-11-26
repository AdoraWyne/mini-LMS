"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConsultationDto } from "@/lib/api/mappers";
import { apiClient } from "@/lib/client/api-client";

/**
 * Query keys in one place. Mutations (6c, 6d) invalidate `consultationKeys.all`, which
 * refetches every consultation query, so the UI always shows the server's true state.
 */
export const consultationKeys = {
  all: ["consultations"] as const,
  mine: () => [...consultationKeys.all, "mine"] as const,
};

/** The caller's own consultations (GET /api/consultations), sorted by the API. */
export function useConsultations() {
  return useQuery({
    queryKey: consultationKeys.mine(),
    queryFn: () => apiClient.get<ConsultationDto[]>("/api/consultations"),
  });
}
