import { requireAdmin } from "@/lib/api/auth";
import { mapDbError } from "@/lib/api/errors";
import { ok, parseInput, withErrorHandling, type PageResult } from "@/lib/api/http";
import { CONSULTATION_COLUMNS, toConsultationDto } from "@/lib/api/mappers";
import { adminListQuerySchema } from "@/lib/api/schemas";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/consultations?page=&pageSize=: every consultation, read-only, paginated.
 *
 * Check order: 401 -> 403 -> 400 (CLAUDE.md "Status codes").
 * Only GET is exported, so POST/PATCH/DELETE get Next.js's 405: the admin view is read-only.
 *
 * Response: { data: { items, page, pageSize, total, totalPages } }. Same { data } envelope as
 * every route; this endpoint's data is a page object.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const supabase = await createClient();
  await requireAdmin(supabase);

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { page, pageSize } = parseInput(adminListQuerySchema, query);

  // Offset pagination (decision 16). .range() is inclusive on both ends.
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // No "mine" filter: RLS's is_admin() branch is what lets this query see every row.
  // count: "exact" = a reliable total, at the cost of counting all rows per request
  // (fine here; cursor pagination + an estimated count for huge tables = "with more time").
  const { data, error, count } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS, { count: "exact" })
    .order("scheduled_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);

  // A page past the end: PostgREST answers 416 "Requested range not satisfiable" (PGRST103)
  // with no count. That's not an error for our API: the collection exists, this page is just
  // empty. Fetch the total on its own (head: true = count only, no rows) and return [].
  if (error?.code === "PGRST103") {
    const { count: totalOnly, error: countError } = await supabase
      .from("consultations")
      .select("id", { count: "exact", head: true });
    if (countError) throw mapDbError(countError);
    return ok(pageResult([], page, pageSize, totalOnly ?? 0));
  }
  if (error) throw mapDbError(error);

  return ok(pageResult(data.map(toConsultationDto), page, pageSize, count ?? 0));
});

function pageResult<T>(items: T[], page: number, pageSize: number, total: number): PageResult<T> {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
