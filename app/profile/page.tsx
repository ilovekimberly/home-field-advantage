import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ProfileForm from "./ProfileForm";

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default async function ProfilePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const displayName = profile?.display_name ?? user.email ?? "Unknown";
  const avatarUrl = (user.user_metadata?.avatar_url as string) ?? null;

  // Fetch all competitions.
  const { data: competitions } = await supabase
    .from("competitions")
    .select("*")
    .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .order("start_date", { ascending: false });

  const compIds = (competitions ?? []).map((c) => c.id);

  // Fetch all picks for stats.
  const { data: allPicks } = compIds.length > 0
    ? await supabase
        .from("picks")
        .select("competition_id, picker_id, result, game_date")
        .in("competition_id", compIds)
        .eq("picker_id", user.id)
    : { data: [] };

  // Overall stats.
  let totalWins = 0, totalLosses = 0, totalPushes = 0;
  for (const p of allPicks ?? []) {
    if (p.result === "win") totalWins++;
    else if (p.result === "loss") totalLosses++;
    else if (p.result === "push") totalPushes++;
  }
  const totalPicks = totalWins + totalLosses + totalPushes;
  const winRate = totalPicks > 0 ? Math.round((totalWins / (totalPicks - totalPushes || 1)) * 100) : null;

  // Fetch opponent profiles.
  const opponentIds = Array.from(new Set(
    (competitions ?? [])
      .map((c) => c.creator_id === user.id ? c.opponent_id : c.creator_id)
      .filter(Boolean)
  ));
  const { data: opponentProfiles } = opponentIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", opponentIds)
    : { data: [] };
  const profileMap = new Map((opponentProfiles ?? []).map((p) => [p.id, p]));

  // Build competition history with outcomes.
  const today = todayISO();
  const history = (competitions ?? []).map((comp) => {
    const picks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const myWins = picks.filter((p) => p.result === "win").length;
    const myLosses = picks.filter((p) => p.result === "loss").length;

    const opponentId = comp.creator_id === user.id ? comp.opponent_id : comp.creator_id;
    const opponent = opponentId ? profileMap.get(opponentId) : null;
    const opponentName = opponent?.display_name ?? opponent?.email ?? null;

    let outcome: "winning" | "losing" | "tied" | "pending" | null = null;
    if (comp.status === "complete" || comp.status === "active") {
      // We need opponent wins too — approximate from all picks.
      // (allPicks only has user's picks, so use total picks in comp for opponent)
    }

    const durationLabel =
      comp.duration === "daily" ? "Single day" :
      comp.duration === "weekly" ? "1 week" : "Full season";

    return { comp, myWins, myLosses, opponentName, durationLabel };
  });

  const activeHistory = history.filter((h) => h.comp.status === "active" || h.comp.status === "pending");
  const pastHistory = history.filter((h) => h.comp.status === "complete" || h.comp.status === "cancelled");

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Your profile</h1>

      {/* Edit form */}
      <ProfileForm
        currentName={displayName}
        avatarUrl={avatarUrl}
        email={user.email ?? ""}
      />

      {/* Stats */}
      <section className="card">
        <h2 className="text-lg font-bold mb-4">Overall stats</h2>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-3xl font-bold text-rink">{totalWins}</div>
            <div className="text-xs text-slate-500 mt-1">Wins</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-600">{totalLosses}</div>
            <div className="text-xs text-slate-500 mt-1">Losses</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-400">{totalPushes}</div>
            <div className="text-xs text-slate-500 mt-1">Pushes</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-green-600">
              {winRate !== null ? `${winRate}%` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-1">Win rate</div>
          </div>
        </div>
        {totalPicks > 0 && (
          <div className="mt-4">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-rink rounded-full transition-all"
                style={{ width: `${winRate ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">{totalPicks} total picks across all competitions</p>
          </div>
        )}
      </section>

      {/* Competition history */}
      {history.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Competition history</h2>

          {activeHistory.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-500 mb-2">Active</h3>
              <ul className="space-y-2">
                {activeHistory.map(({ comp, myWins, myLosses, opponentName, durationLabel }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-rink">{comp.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {durationLabel} · vs {opponentName ?? "Awaiting opponent"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{myWins}–{myLosses}</div>
                          <div className="text-xs text-slate-400">my picks</div>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pastHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-2">Past</h3>
              <ul className="space-y-2">
                {pastHistory.map(({ comp, myWins, myLosses, opponentName, durationLabel }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-slate-700">{comp.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {durationLabel} · {comp.start_date}
                            {opponentName ? ` · vs ${opponentName}` : ""}
                          </div>
                        </div>
                        <div className="text-right">
                          {comp.status === "cancelled" ? (
                            <span className="text-xs text-slate-400 italic">Cancelled</span>
                          ) : (
                            <>
                              <div className="font-bold">{myWins}–{myLosses}</div>
                              <div className="text-xs text-slate-400">my picks</div>
                            </>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
