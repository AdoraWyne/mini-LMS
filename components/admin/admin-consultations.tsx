"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConsultationTable } from "@/components/consultations/consultation-table";
import { Button } from "@/components/ui/button";
import { useAdminConsultations } from "@/hooks/use-admin-consultations";
import { useNow } from "@/hooks/use-now";
import { parsePageParam } from "@/lib/client/page-param";
import { Pagination } from "./pagination";

/**
 * The read-only admin list. The page number lives in the URL (?page=2): refresh keeps it,
 * the back button works, links can be shared. Uses useSearchParams, so it's rendered
 * inside <Suspense> (Next.js requirement).
 */
export function AdminConsultations() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const page = parsePageParam(searchParams.get("page"));
  const now = useNow();
  const { data, error, isPending, isPlaceholderData, refetch, isRefetching } = useAdminConsultations(page);

  const goTo = (nextPage: number) => router.push(`${pathname}?page=${nextPage}`);

  if (isPending || !now) return <p className="text-muted-foreground">Loading…</p>;

  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between rounded-md border border-destructive px-4 py-3 text-sm">
        <span>Couldn&apos;t load consultations: {error.message}</span>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
          Try again
        </Button>
      </div>
    );
  }

  if (data.total === 0) return <p className="rounded-md border px-4 py-6">No consultations yet.</p>;

  if (data.items.length === 0) {
    // A page past the end (e.g. a hand-edited ?page=99): the API answers 200 with no items.
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border px-4 py-6">
        <p>No consultations on this page.</p>
        <Button asChild variant="outline" size="sm">
          <Link href={`${pathname}?page=${data.totalPages}`}>Go to the last page ({data.totalPages})</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {data.total} consultation{data.total === 1 ? "" : "s"} in total. Read-only.
      </p>
      {/* No renderActions: the admin view is read-only (no admin update policy in RLS either). */}
      <ConsultationTable consultations={data.items} now={now} showStudent />
      <Pagination page={data.page} totalPages={data.totalPages} loading={isPlaceholderData} onPageChange={goTo} />
    </div>
  );
}
