/**
 * Converting between <input type="datetime-local"> values and UTC ISO strings (decision 10).
 *
 * A datetime-local value ("2026-12-01T21:00") is a wall-clock time with NO offset. It means
 * "21:00 wherever the viewer is". The API needs one unambiguous moment, so the browser
 * converts it to UTC with the viewer's own timezone.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** UTC ISO -> the viewer's local "YYYY-MM-DDTHH:mm" (to pre-fill an input or set `min`). */
export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  // Local getters on purpose (getHours, not getUTCHours): the input shows the viewer's time.
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The viewer's local "YYYY-MM-DDTHH:mm" -> UTC ISO, or null if the value isn't a valid date.
 *
 * `new Date("2026-12-01T21:00")` parses a date-time WITHOUT an offset as local time (per the
 * JS spec). A local time skipped by daylight saving is moved forward to a real moment.
 */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
