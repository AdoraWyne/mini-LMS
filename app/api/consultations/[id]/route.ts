import { requireUser } from "@/lib/api/auth";
import { ApiError, mapDbError } from "@/lib/api/errors";
import { ok, parseInput, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { CONSULTATION_COLUMNS, toConsultationDto } from "@/lib/api/mappers";
import { consultationIdSchema, patchConsultationSchema } from "@/lib/api/schemas";
import { transitionFor } from "@/lib/api/transitions";
import { createClient } from "@/lib/supabase/server";

// Next.js 15+: dynamic route params are a Promise.
type RouteContext = { params: Promise<{ id: string }> };

const notFound = () => new ApiError(404, "Consultation not found");

/**
 * PATCH /api/consultations/[id]: one action = one state transition (decision 9).
 *
 * Check order (CLAUDE.md "Status codes"):
 *   401 not logged in
 *   404 path id isn't a UUID   (step 3, id first: it's the address, not input)
 *   400 invalid body           (step 3, then the body)
 *   404 not found / not yours
 *   409 yours, but not allowed in its current state/time
 */
export const PATCH = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const supabase = await createClient();
  const { userId } = await requireUser(supabase);

  // Validate the id before any query, so a malformed id never reaches Postgres (which would 500).
  const idResult = consultationIdSchema.safeParse((await params).id);
  if (!idResult.success) throw notFound();
  const id = idResult.data;

  const input = parseInput(patchConsultationSchema, await parseJsonBody(request));
  const transition = transitionFor(input, new Date());

  // ONE atomic UPDATE: the "allowed when" rules are part of the WHERE clause (decision 9a),
  // so two concurrent requests can't both pass a check and then both write.
  let update = supabase
    .from("consultations")
    .update(transition.set)
    .eq("id", id)
    // Always "mine". RLS's update policy already limits this to own rows (so no test can tell
    // this filter apart from RLS), but ownership stays visible here and doesn't rely on one layer.
    .eq("student_id", userId)
    .eq("status", transition.requiredStatus);

  const condition = transition.scheduledAtCondition;
  if (condition?.operator === "lte") update = update.lte("scheduled_at", condition.value);
  if (condition?.operator === "gt") update = update.gt("scheduled_at", condition.value);

  const { data: updated, error } = await update.select(CONSULTATION_COLUMNS);
  // Trigger rejections (e.g. clocks disagree at the boundary) map to 400/409, anything else to 500.
  if (error) throw mapDbError(error);
  if (updated.length === 1) return ok(toConsultationDto(updated[0]));

  // 0 rows changed. Tell "yours, but not allowed now" (409) from "not found / not yours" (404).
  // Filtered by student_id = me, so someone else's row is a 404 and its existence never leaks.
  const { data: own, error: lookupError } = await supabase
    .from("consultations")
    .select("id")
    .eq("id", id)
    .eq("student_id", userId)
    .maybeSingle();
  if (lookupError) throw mapDbError(lookupError);
  if (own) throw new ApiError(409, transition.conflictMessage);
  throw notFound();
});
