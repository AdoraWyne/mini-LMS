import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase, testEnv } from "./env";

/**
 * THE ONLY place a service-role client is created (CLAUDE.md, decision 3).
 *
 * The service role bypasses RLS and grants, so `admin` is for test SETUP, CLEANUP and
 * VERIFICATION READS only: creating confirmed users, making someone admin, seeding past
 * bookings, deleting users, and reading a row back to prove a blocked action didn't change it.
 * Assertions about what a user can do must go through asStudent()/asAdmin()/asAnon()
 * (publishable key, real sessions).
 *
 * App code can't import this: ESLint's no-restricted-imports blocks `tests/` everywhere
 * except inside tests/ itself.
 */

// Guard runs at import time, before the client exists, so no setup or cleanup
// can ever reach a non-local project.
assertLocalSupabase(testEnv.supabaseUrl);

export const admin = createClient(testEnv.supabaseUrl, testEnv.serviceRoleKey, {
  // Server-to-server client: no browser session to store or refresh.
  auth: { persistSession: false, autoRefreshToken: false },
});
