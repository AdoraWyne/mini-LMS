import { safeNextPath } from "@/lib/auth/safe-next-path";
import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only same-site paths: an unchecked `next` is an open redirect
  // (e.g. ?next=//evil.example would send the freshly logged-in user to another site).
  const next = safeNextPath(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // redirect user to the (validated) redirect path, /dashboard by default
      redirect(next);
    } else {
      // redirect the user to an error page with some instructions
      // Encode: the message is free text (spaces, "&", "#"...) going into a query string.
      redirect(`/auth/error?error=${encodeURIComponent(error.message)}`);
    }
  }

  // redirect the user to an error page with some instructions
  redirect(`/auth/error?error=${encodeURIComponent("No token hash or type")}`);
}
