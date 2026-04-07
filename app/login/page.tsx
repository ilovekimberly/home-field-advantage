"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  async function signInWithGoogle() {
    const supabase = createSupabaseBrowserClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return (
    <div className="mx-auto max-w-md card text-center">
      <h1 className="text-2xl font-bold mb-2">Sign in</h1>
      <p className="text-slate-600 mb-6">Use your Google account to start a pick'em.</p>
      <button onClick={signInWithGoogle} className="btn-primary w-full">
        Continue with Google
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center text-slate-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
