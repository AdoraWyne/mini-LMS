import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminConsultations } from "@/components/admin/admin-consultations";
import { isAdmin } from "@/lib/auth/is-admin";
import { createClient } from "@/lib/supabase/server";

/**
 * /admin: read-only list of every consultation.
 *
 * The role check here is UX only: it hides the page from non-admins. The real protection is
 * the API's requireAdmin() (403) and RLS (a student's query only ever sees their own rows).
 *
 * The check reads cookies, so with cacheComponents it must run inside <Suspense>.
 */
export default function AdminPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <AdminGate />
    </Suspense>
  );
}

async function AdminGate() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // Not logged in (normally the proxy redirects first) or not an admin: same 404, so the page
  // doesn't confirm that an admin area exists. A DB error throws (error page), not a fake 404.
  if (!data?.claims || !(await isAdmin(supabase))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">All consultations</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <AdminConsultations />
      </Suspense>
    </div>
  );
}
