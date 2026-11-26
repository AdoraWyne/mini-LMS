/**
 * The admin page number from the URL (?page=). Anything that isn't a plain positive integer
 * falls back to 1, so a hand-edited URL never sends the API an invalid page (a 400).
 */
export function parsePageParam(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  return Number(value);
}
