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
              {user ? (
                <>
                  <span className="text-slate-600 hidden sm:block">{user.email}</span>
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
