"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` (default 30s). `null` until mounted in the browser.
 *
 * Why null first: with `cacheComponents: true` (next.config.ts), Next.js prerenders pages
 * ahead of time, client components included. Reading the clock during render (e.g.
 * `useState(() => new Date())`) would bake the prerender time into the page, so Next.js
 * rejects it. Reading it in useEffect means it only ever runs in the browser, per visit.
 *
 * Time-based UI (the complete checkbox, "Awaiting completion") changes when a consultation's
 * time passes without any data changing; the interval re-renders so the UI catches up.
 * The server still decides: if the UI is a few seconds behind, the API answers 409.
 */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
