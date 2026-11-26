"use client";

import Link from "next/link";
import { Suspense } from "react";
import { BookedNotice } from "@/components/consultations/booked-notice";
import { ConsultationTable } from "@/components/consultations/consultation-table";
import { Button } from "@/components/ui/button";
import { useConsultations } from "@/hooks/use-consultations";
import { useNow } from "@/hooks/use-now";

/**
 * /dashboard: my consultations.
 *
 * Client component, data fetched in the browser (TanStack Query -> our API, decision 11).
 * The server (pre)render is just "Loading…": the data only arrives in the browser, and
 * useNow() is null until mounted. So times (toLocaleString) and `now` are only ever computed
 * in the browser: no server/browser timezone mismatch during hydration, and no prerender
 * baking in a stale clock (cacheComponents, see hooks/use-now.ts).
 */
export default function DashboardPage() {
  const { data, error, isPending, refetch, isRefetching } = useConsultations();
  const now = useNow();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">My consultations</h1>
        <Button asChild>
          <Link href="/dashboard/new">Book consultation</Link>
        </Button>
      </div>

      <Suspense>
        <BookedNotice />
      </Suspense>

      {isPending || !now ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : error ? (
        // A 401 never gets here: the QueryClient sends the user to /auth/login.
        <div role="alert" className="flex items-center justify-between rounded-md border border-destructive px-4 py-3 text-sm">
          <span>Couldn&apos;t load your consultations: {error.message}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            Try again
          </Button>
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-md border px-4 py-6">
          <p>No consultations yet.</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/new">Book your first consultation</Link>
          </Button>
        </div>
      ) : (
        <ConsultationTable consultations={data} now={now} />
      )}
    </div>
  );
}
