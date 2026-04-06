import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let competitions: any[] = [];
  if (user) {
    const { data } = await supabase
      .from("competitions")
      .select("*")
      .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    competitions = data ?? [];
  }

  return (
    <div className="space-y-10">
      <section className="card">
        <h1 className="text-3xl font-bold">Pick'em with your friends.</h1>
        <p className="mt-2 text-slate-600">
          Build NHL pick'em competitions that last a single night, a week, or the
          whole regular season. Snake-draft picks, head-to-head, automatic scoring.
        </p>
        {!user && (
          <Link href="/login" className="btn-primary mt-4">Sign in to start</Link>
        )}
      </section>

      {user && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold">Your competitions</h2>
            <Link href="/competitions/new" className="btn-primary">+ New</Link>
          </div>
          {competitions.length === 0 ? (
            <p className="text-slate-500">No competitions yet. Create one to get started.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {competitions.map((c) => (
                <li key={c.id} className="card">
                  <Link href={`/competitions/${c.id}`} className="font-semibold text-rink hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-sm text-slate-500">
                    {c.duration} · {c.start_date} → {c.end_date} · {c.status}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
