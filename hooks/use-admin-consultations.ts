"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PageResult } from "@/lib/api/http";
import type { ConsultationDto } from "@/lib/api/mappers";
import { apiClient } from "@/lib/client/api-client";
import { consultationKeys } from "./use-consultations";

/**
 * One page of ALL consultations (GET /api/admin/consultations, admins only).
 *
 * The key sits under consultationKeys.all, so any booking or update (e.g. the admin booking
 * their own) also refreshes this list. keepPreviousData keeps the current page on screen
 * while the next one loads, instead of flashing an empty table.
 */
export function useAdminConsultations(page: number) {
  return useQuery({
    queryKey: [...consultationKeys.all, "admin", page] as const,
    queryFn: () => apiClient.get<PageResult<ConsultationDto>>(`/api/admin/consultations?page=${page}`),
    placeholderData: keepPreviousData,
  });
}
