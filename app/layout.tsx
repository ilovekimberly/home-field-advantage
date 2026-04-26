import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Sidebar from "./Sidebar";
import TurnBadge from "./TurnBadge";

export const metadata: Metadata = {
  title: "My Home Field",
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
            <div className="flex items-center gap-4">
              <Link href="/" className="text-lg font-bold text-rink">🏒 My Home Field</Link>
              <Link href="/how-it-works" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-rink bg-ice border border-rink/20 px-3 py-1.5 rounded-full hover:bg-rink hover:text-white transition-colors">
                How it works
              </Link>
            </div>
            <nav className="flex items-center gap-3 text-sm">
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
                  <TurnBadge userId={user.id} />
                  <Link href="/suggest" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-rink transition-colors">💡 Share an Idea</Link>
                  <Link href="/support" className="hidden sm:inline-flex text-lg text-slate-400 hover:text-rink transition-colors" title="Support">❓</Link>
                  <form action="/auth/signout" method="post">
                    <button className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1" type="submit">Sign out</button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="btn-primary">Sign in</Link>
              )}
            </nav>
          </div>
        </header>

        <div className="flex pt-[65px] min-h-screen flex-col">
          <div className="flex flex-1">
            {user && <Sidebar competitions={competitions} />}
            <main className="flex-1 px-4 sm:px-6 py-6 sm:py-10 max-w-4xl mx-auto w-full">
              {children}
            </main>
          </div>
          <footer className="border-t border-slate-100 py-4 px-6">
            <div className="max-w-screen-xl mx-auto text-xs text-slate-400">
              <span>© {new Date().getFullYear()} My Home Field</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
