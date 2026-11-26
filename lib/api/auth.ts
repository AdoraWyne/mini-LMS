import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ApiError, mapDbError } from "./errors";

type Supabase = SupabaseClient<Database>;

export type AuthenticatedUser = { userId: string };

/**
 * 401 unless the request has a valid session.
 *
 * getClaims() verifies the JWT's signature (decision 13), so a forged or tampered
 * cookie (e.g. someone editing `sub` to another user's id) has no claims and gets 401.
 * Never getSession() on the server: it trusts the cookie without verifying it.
 *
 * The user id comes from claims.sub (the JWT subject), never from the request.
 */
export async function requireUser(supabase: Supabase): Promise<AuthenticatedUser> {
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) throw new ApiError(401, "Not logged in");
  return { userId };
}

/**
 * 401 if logged out, 403 if logged in but not an admin.
 *
 * Uses the same is_admin() SQL function the RLS policies use, so "who is an admin"
 * has one definition, read from public.profiles (never user_metadata, decision 1).
 */
export async function requireAdmin(supabase: Supabase): Promise<AuthenticatedUser> {
  const user = await requireUser(supabase);
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) throw mapDbError(error);
  if (!isAdmin) throw new ApiError(403, "Admins only");
  return user;
}
