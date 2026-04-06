import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` is where we want to send the user after sign-in (e.g. /join/abc123)
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Only allow relative paths to prevent open-redirect attacks.
  const safePath = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(`${origin}${safePath}`);
}
