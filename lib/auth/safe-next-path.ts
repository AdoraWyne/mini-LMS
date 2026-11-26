export const DEFAULT_NEXT_PATH = "/dashboard";

/**
 * Only allows same-site paths as a post-login redirect target (prevents an open redirect).
 *
 * Accepted: a path starting with "/" (e.g. "/dashboard", "/admin?page=2").
 * Rejected (falls back to /dashboard):
 * - absolute URLs ("https://evil.example")
 * - protocol-relative URLs ("//evil.example"): the browser treats these as another site
 * - "/\evil.example": browsers normalise "\" to "/", so this becomes "//evil.example"
 * - anything else that doesn't start with "/" ("javascript:...", "dashboard")
 */
export function safeNextPath(next: string | null): string {
  if (!next) return DEFAULT_NEXT_PATH;
  if (!next.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT_PATH;
  return next;
}
