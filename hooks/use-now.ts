"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` (default 30s).
 *
 * Time-based UI (the complete checkbox, "Awaiting completion") changes when a consultation's
 * time passes, without any data changing. This re-renders so the UI catches up without a reload.
 * The server still decides: if the UI is a few seconds behind, the API answers 409.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
