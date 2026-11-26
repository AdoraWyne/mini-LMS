import { requireUser } from "@/lib/api/auth";
import { mapDbError } from "@/lib/api/errors";
import { ok, parseInput, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { CONSULTATION_COLUMNS, toConsultationDto } from "@/lib/api/mappers";
import { createConsultationSchema } from "@/lib/api/schemas";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/consultations: the caller's own consultations, oldest first.
 * Check order: 401 (CLAUDE.md "Status codes").
 */
export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  const { userId } = await requireUser(supabase);

  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    // Explicit "mine" filter even though RLS also restricts rows: RLS lets an admin see
    // EVERY row, and this route is "my consultations" for everyone (decision 15).
    // It also matches the (student_id, scheduled_at, id) index.
    .eq("student_id", userId)
    .order("scheduled_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw mapDbError(error);

  return ok(data.map(toConsultationDto));
});

/**
 * POST /api/consultations: book a consultation for the caller.
 * Check order: 401 -> 400. A trigger rejection (LM400/LM409) maps to 400/409.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const supabase = await createClient();
  const { userId } = await requireUser(supabase);

  const input = parseInput(createConsultationSchema, await parseJsonBody(request));

  const { data, error } = await supabase
    .from("consultations")
    .insert({
      // Ownership always from the session, never the body (the strict schema rejects
      // studentId anyway). RLS's `with check` verifies it again.
      student_id: userId,
      first_name: input.firstName,
      last_name: input.lastName,
      reason: input.reason,
      scheduled_at: input.scheduledAt,
      // status, id, created_at, updated_at: DB defaults (the column grants don't even allow them).
    })
    .select(CONSULTATION_COLUMNS)
    .single();
  if (error) throw mapDbError(error);

  return ok(toConsultationDto(data), 201);
});
