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

  // Fetch ALL picks (both players) so we can compute outcomes and standings.
  const { data: allPicks } = compIds.length > 0
    ? await supabase
        .from("picks")
        .select("competition_id, picker_id, result, game_date")
        .in("competition_id", compIds)
    : { data: [] };

  const myPicks = (allPicks ?? []).filter((p) => p.picker_id === user.id);

  // Overall stats.
  let totalWins = 0, totalLosses = 0, totalPushes = 0, perfectNights = 0;
  for (const p of myPicks) {
    if (p.result === "win") totalWins++;
    else if (p.result === "loss") totalLosses++;
    else if (p.result === "push") totalPushes++;
  }
  const totalPicks = totalWins + totalLosses + totalPushes;
  const winRate = totalPicks > 0 ? Math.round((totalWins / (totalPicks - totalPushes || 1)) * 100) : null;

  // Count perfect nights (days where user had ≥1 pick, all are fully scored, and all were wins).
  const myPicksByDate = myPicks.reduce((acc, p) => {
    const key = `${p.competition_id}__${p.game_date}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, typeof myPicks>);
  for (const picks of Object.values(myPicksByDate)) {
    // Require at least 2 picks — a solo 1-pick win isn't a "perfect night".
    if (picks.length < 2) continue;
    // Skip nights that aren't fully resolved yet.
    const anyUnresolved = picks.some((p) => p.result !== "win" && p.result !== "loss" && p.result !== "push");
    if (anyUnresolved) continue;
    if (picks.every((p) => p.result === "win")) perfectNights++;
  }

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

  // Build competition history with proper outcomes using all picks.
  const today = todayISO();
  const history = (competitions ?? []).map((comp) => {
    const compPicks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const myWins   = compPicks.filter((p) => p.picker_id === user.id && p.result === "win").length;
    const myLosses = compPicks.filter((p) => p.picker_id === user.id && p.result === "loss").length;

    const opponentId = comp.creator_id === user.id ? comp.opponent_id : comp.creator_id;
    const opponent = opponentId ? profileMap.get(opponentId) : null;
    const opponentName = opponent?.display_name ?? opponent?.email ?? null;

    const theirWins   = compPicks.filter((p) => p.picker_id === opponentId && p.result === "win").length;
    const theirLosses = compPicks.filter((p) => p.picker_id === opponentId && p.result === "loss").length;

    let outcome: "winning" | "losing" | "tied" | null = null;
    if (myWins + myLosses + theirWins + theirLosses > 0) {
      if (myWins > theirWins) outcome = "winning";
      else if (theirWins > myWins) outcome = "losing";
      else outcome = "tied";
    }

    const durationLabel =
      comp.duration === "daily"   ? "Single day" :
      comp.duration === "weekly"  ? "1 week" :
      comp.duration === "playoff" ? "Playoffs" : "Full season";

    return { comp, myWins, myLosses, theirWins, theirLosses, outcome, opponentName, durationLabel };
  });

  const activeHistory = history.filter((h) => h.comp.status === "active" || h.comp.status === "pending");
  const pastHistory = history.filter((h) => h.comp.status === "complete" || h.comp.status === "cancelled");

  // Competition-level wins by duration (only completed comps where user had more wins than opponent).
  const completedWins = history.filter((h) => h.comp.status === "complete" && h.outcome === "winning");
  const compWins = {
    daily:   completedWins.filter((h) => h.comp.duration === "daily").length,
    weekly:  completedWins.filter((h) => h.comp.duration === "weekly").length,
    season:  completedWins.filter((h) => h.comp.duration === "season").length,
    playoff: completedWins.filter((h) => h.comp.duration === "playoff").length,
  };
  const totalCompWins = compWins.daily + compWins.weekly + compWins.season + compWins.playoff;
  const totalCompPlayed = history.filter((h) => h.comp.status === "complete" && h.outcome !== null).length;

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
        <div className="grid grid-cols-5 gap-3 text-center">
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
          <div>
            <div className="text-3xl font-bold text-amber-500">{perfectNights}</div>
            <div className="text-xs text-slate-500 mt-1">🔥 Perfect nights</div>
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

      {/* Competition wins */}
      {totalCompPlayed > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold mb-1">Competition wins</h2>
          <p className="text-xs text-slate-500 mb-4">
            {totalCompWins}–{totalCompPlayed - totalCompWins} across {totalCompPlayed} completed competition{totalCompPlayed !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: "Daily",   count: compWins.daily,   active: true },
              { label: "Weekly",  count: compWins.weekly,  active: true },
              { label: "Season",  count: compWins.season,  active: true },
              { label: "Playoff", count: compWins.playoff, active: false },
            ].map(({ label, count, active }) => (
              <div key={label}>
                <div className={`text-3xl font-bold ${active && count > 0 ? "text-rink" : "text-slate-300"}`}>
                  {active ? count : "—"}
                </div>
                <div className="text-xs text-slate-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Competition history */}
      {history.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Competition history</h2>

          {activeHistory.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-500 mb-2">Active</h3>
              <ul className="space-y-2">
                {activeHistory.map(({ comp, myWins, myLosses, theirWins, outcome, opponentName, durationLabel }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-rink truncate">{comp.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {durationLabel} · vs {opponentName ?? "Awaiting opponent"}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold">{myWins}–{theirWins}</div>
                          {outcome && (
                            <div className={`text-xs font-semibold mt-0.5 ${
                              outcome === "winning" ? "text-green-600" :
                              outcome === "losing"  ? "text-red-500"   : "text-slate-400"
                            }`}>
                              {outcome === "winning" ? "Winning" : outcome === "losing" ? "Losing" : "Tied"}
                            </div>
                          )}
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
                {pastHistory.map(({ comp, myWins, theirWins, outcome, opponentName, durationLabel }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-700 truncate">{comp.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {durationLabel} · {comp.start_date}
                            {opponentName ? ` · vs ${opponentName}` : ""}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {comp.status === "cancelled" ? (
                            <span className="text-xs text-slate-400 italic">Cancelled</span>
                          ) : (
                            <>
                              <div className="font-bold">{myWins}–{theirWins}</div>
                              {outcome && (
                                <div className={`text-xs font-semibold mt-0.5 ${
                                  outcome === "winning" ? "text-green-600" :
                                  outcome === "losing"  ? "text-red-500"   : "text-slate-400"
                                }`}>
                                  {outcome === "winning" ? "Won" : outcome === "losing" ? "Lost" : "Tied"}
                                </div>
                              )}
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
