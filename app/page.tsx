import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

/**
 * Home: logged-in users go straight to their dashboard; everyone else sees Log in / Sign up.
 * getClaims() verifies the JWT (decision 13). The proxy doesn't redirect "/", so this page decides.
 */
export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/dashboard");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold">Mini LMS</h1>
      <p className="text-muted-foreground">Book and manage your consultations.</p>
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/auth/login">Log in</Link>
        </Button>
        <Button asChild>
          <Link href="/auth/sign-up">Sign up</Link>
        </Button>
      </div>
    </main>
  );
}
