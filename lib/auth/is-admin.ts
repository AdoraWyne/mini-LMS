import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Server-side role check for PAGES (header link, /admin's notFound()). UX only: the real
 * protection is the API's requireAdmin() (403) and RLS.
 *
 * Same is_admin() SQL function the RLS policies and requireAdmin() use, so "who is an admin"
 * has one definition (public.profiles, never user_metadata). It's an RPC from a server
 * component, not the UI querying tables, so decision 11 still holds.
 *
 * Throws on a DB error; callers decide what failing means (the header fails closed: no link).
 */
export async function isAdmin(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) throw new Error(`is_admin() failed: ${error.message}`);
  return data === true;
}
