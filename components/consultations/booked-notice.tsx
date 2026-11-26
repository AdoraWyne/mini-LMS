"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * "Booked" message after the booking form redirects to /dashboard?booked=1.
 * The flag is removed from the URL straight away (router.replace, no new history entry),
 * so a refresh or the back button doesn't show the message again.
 *
 * Uses useSearchParams, so it must be rendered inside <Suspense> (Next.js requirement).
 */
export function BookedNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get("booked") !== "1") return;
    setVisible(true);
    router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  if (!visible) return null;
  return (
    <div role="status" className="flex items-center justify-between rounded-md border bg-accent px-4 py-3 text-sm">
      <span>Booked. Your consultation is in the list below.</span>
      <button type="button" className="underline" onClick={() => setVisible(false)}>
        Dismiss
      </button>
    </div>
  );
}
