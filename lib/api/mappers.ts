import type { Enums, Tables } from "@/lib/database.types";

export type ConsultationStatus = Enums<"consultation_status">;

/** A consultation as the API returns it (camelCase, ISO UTC times). */
export type ConsultationDto = {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  reason: string;
  scheduledAt: string;
  status: ConsultationStatus;
  createdAt: string;
  updatedAt: string;
};

/** Postgres returns e.g. "2026-12-01T10:00:00+00:00"; the API always returns "2026-12-01T10:00:00.000Z". */
function toIsoUtc(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

/** The one place DB snake_case becomes API camelCase. */
export function toConsultationDto(row: Tables<"consultations">): ConsultationDto {
  return {
    id: row.id,
    studentId: row.student_id,
    firstName: row.first_name,
    lastName: row.last_name,
    reason: row.reason,
    scheduledAt: toIsoUtc(row.scheduled_at),
    status: row.status,
    createdAt: toIsoUtc(row.created_at),
    updatedAt: toIsoUtc(row.updated_at),
  };
}
