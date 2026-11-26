/**
 * Unit tests for lib/auth/safe-next-path.ts: the open-redirect fix in app/auth/confirm/route.ts.
 *
 * The confirm route redirects to `?next=...` after verifying an email link. Without a check,
 * a link like /auth/confirm?...&next=https://evil.example sends a freshly logged-in user
 * to an attacker's site. Only same-site paths are allowed.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, safeNextPath } from "@/lib/auth/safe-next-path";

describe("safeNextPath", () => {
  it("defaults to /dashboard", () => {
    expect(DEFAULT_NEXT_PATH).toBe("/dashboard");
  });

  it.each([
    ["/dashboard"],
    ["/dashboard/new"],
    ["/admin?page=2"],
    ["/auth/update-password"],
    ["/"],
  ])("accepts the same-site path %j", (next) => {
    expect(safeNextPath(next)).toBe(next);
  });

  it.each([
    { next: null, reason: "missing" },
    { next: "", reason: "empty" },
    { next: "https://evil.example", reason: "absolute URL" },
    { next: "http://evil.example/dashboard", reason: "absolute http URL" },
    { next: "//evil.example", reason: "protocol-relative URL (browser treats it as https://evil.example)" },
    { next: "//evil.example/dashboard", reason: "protocol-relative URL with a path" },
    { next: "/\\evil.example", reason: "backslash trick (browsers normalise \\ to /, so this becomes //evil.example)" },
    { next: "javascript:alert(1)", reason: "javascript: URL" },
    { next: "dashboard", reason: "relative path without a leading slash" },
  ])("rejects $next ($reason) and falls back to /dashboard", ({ next }) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });
});
