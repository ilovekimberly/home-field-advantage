import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Sidebar from "./Sidebar";

export const metadata: Metadata = {
  title: "Home Field Advantage",
  description: "Pick'em competitions with your friends.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let competitions: any[] = [];
  if (user) {
    const { data } = await supabase
      .from("competitions")
      .select("id, name, sport, duration, status, start_date, opponent_id")
      .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    competitions = data ?? [];
  }

  return (
    <html lang="en">
      <body>
        <header className="fixed top-0 left-0 right-0 z-40 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-bold text-rink">🏒 Home Field Advantage</Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/how-it-works" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-rink bg-ice border border-rink/20 px-3 py-1.5 rounded-full hover:bg-rink hover:text-white transition-colors">
                ❓ How it works
              </Link>
            {user ? (
                <>
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  >
                    {user.user_metadata?.avatar_url ? (
                      <img
                        src={user.user_metadata.avatar_url}
                        alt="Profile"
                        className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-200"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-rink flex items-center justify-center text-white text-sm font-bold">
                        {(user.email ?? "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-slate-600 text-sm hidden sm:block">
                      {user.user_metadata?.name ?? user.email}
                    </span>
                  </Link>
                  <form action="/auth/signout" method="post">
                    <button className="btn-ghost" type="submit">Sign out</button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="btn-primary">Sign in</Link>
              )}
            </nav>
          </div>
        </header>

        <div className="flex pt-[65px] min-h-screen">
          {user && <Sidebar competitions={competitions} />}
          <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
