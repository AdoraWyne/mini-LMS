import { admin } from "./admin-client";

export type ConsultationStatus = "scheduled" | "completed" | "cancelled";

/** ISO timestamp `days` from now (negative = in the past). */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Setup only (uses `admin`). Inserts a consultation directly, bypassing RLS, grants
 * and the business-rule trigger (it only applies to `authenticated`). This is how we
 * create states a student can't create themselves, e.g. a past booking to complete.
 */
export async function seedConsultation(input: {
  studentId: string;
  scheduledAt: string;
  status?: ConsultationStatus;
}): Promise<string> {
  const { data, error } = await admin
    .from("consultations")
    .insert({
      student_id: input.studentId,
      first_name: "Test",
      last_name: "Student",
      reason: "Seeded by tests",
      scheduled_at: input.scheduledAt,
      status: input.status ?? "scheduled",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedConsultation failed: ${error.message}`);
  return data.id;
}

/** Setup/verification only (uses `admin`). Reads a row regardless of RLS, to check it really didn't change. */
export async function readConsultationAsAdmin(id: string) {
  const { data, error } = await admin
    .from("consultations")
    .select("id, student_id, reason, scheduled_at, status, created_at, updated_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(`readConsultationAsAdmin(${id}) failed: ${error.message}`);
  return data;
}
