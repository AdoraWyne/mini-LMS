import { z } from "zod";

// Validate test config up front, so a missing value fails with a clear message
// instead of a confusing auth error halfway through a test.
const testEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string({ error: "SUPABASE_SERVICE_ROLE_KEY is missing. Copy .env.test.example to .env.test.local." })
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is empty. Get it from `npx supabase status`."),
});

const parsed = testEnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid test environment:\n${z.prettifyError(parsed.error)}`);
}

export const testEnv = {
  supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
};

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Localhost guard. Test setup creates and deletes users with the service-role key,
 * so it must never point at a hosted project. Throws before any client is created.
 */
export function assertLocalSupabase(url: string): void {
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Refusing to run tests against non-local Supabase (${hostname}). ` +
        "Tests use the service-role key for setup/cleanup and must only target local Supabase.",
    );
  }
}
