import Link from "next/link";
import { AuthButton } from "@/components/auth-button";
import { isAdmin } from "@/lib/auth/is-admin";
import { createClient } from "@/lib/supabase/server";

/** Fails closed: if the role check errors, no admin link (the link is UX only anyway). */
async function showAdminLink(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return false;
  try {
    return await isAdmin(supabase);
  } catch {
    return false;
  }
}

export async function AppHeader() {
  const admin = await showAdminLink();

  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
      <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center">
          <Link href="/dashboard" className="font-semibold">
            Mini LMS
          </Link>
          <Link href="/dashboard" className="hover:underline">
            My consultations
          </Link>
          {/* UX only: the API answers 403 and RLS hides other rows for non-admins. */}
          {admin && (
            <Link href="/admin" className="hover:underline">
              Admin
            </Link>
          )}
        </div>
        <AuthButton />
      </div>
    </nav>
  );
}
