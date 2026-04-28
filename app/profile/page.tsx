import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ProfileForm from "./ProfileForm";

const SPORT_EMOJI: Record<string, string> = { NHL: "🏒", MLB: "⚾", EPL: "⚽", FIFA: "🏆" };
const PODIUM = ["🥇", "🥈", "🥉"];

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
  const avatarUrl   = (user.user_metadata?.avatar_url as string) ?? null;

  // ── 1v1 competitions ────────────────────────────────────────────────────
  const { data: v1Comps } = await supabase
    .from("competitions")
    .select("*")
    .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .neq("format", "pool")
    .order("start_date", { ascending: false });

  // ── Pool competitions ────────────────────────────────────────────────────
  const { data: memberRows } = await supabase
    .from("competition_members")
    .select("competition_id")
    .eq("user_id", user.id);
  const poolCompIds = (memberRows ?? []).map((r: any) => r.competition_id);

  const { data: poolComps } = poolCompIds.length > 0
    ? await supabase
        .from("competitions")
        .select("*")
        .in("id", poolCompIds)
        .order("start_date", { ascending: false })
    : { data: [] };

  const allComps  = [...(v1Comps ?? []), ...(poolComps ?? [])];
  const allCompIds = allComps.map((c) => c.id);

  // ── All picks across all competitions ───────────────────────────────────
  const { data: allPicks } = allCompIds.length > 0
    ? await supabase
        .from("picks")
        .select("competition_id, picker_id, result, game_date")
        .in("competition_id", allCompIds)
    : { data: [] };

  const myPicks = (allPicks ?? []).filter((p) => p.picker_id === user.id);

  // ── Overall pick stats (1v1 + pool combined) ────────────────────────────
  let totalWins = 0, totalLosses = 0, totalPushes = 0, perfectNights = 0;
  for (const p of myPicks) {
    if (p.result === "win")  totalWins++;
    else if (p.result === "loss")  totalLosses++;
    else if (p.result === "push") totalPushes++;
  }
  const totalPicks = totalWins + totalLosses + totalPushes;
  const winRate = totalPicks > 0
    ? Math.round((totalWins / (totalPicks - totalPushes || 1)) * 100)
    : null;

  const myPicksByDate = myPicks.reduce((acc, p) => {
    const key = `${p.competition_id}__${p.game_date}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, typeof myPicks>);
  for (const picks of Object.values(myPicksByDate)) {
    if (picks.length < 2) continue;
    const anyUnresolved = picks.some((p) => p.result !== "win" && p.result !== "loss" && p.result !== "push");
    if (anyUnresolved) continue;
    if (picks.every((p) => p.result === "win")) perfectNights++;
  }

  // ── Pool member IDs for display names ───────────────────────────────────
  const { data: poolMemberRows } = poolCompIds.length > 0
    ? await supabase
        .from("competition_members")
        .select("competition_id, user_id")
        .in("competition_id", poolCompIds)
    : { data: [] };

  // ── Pool leaderboard ranks ───────────────────────────────────────────────
  // For each completed pool, rank members by wins. Track user's finishing position.
  const poolRanks: Record<string, number> = {}; // comp_id → user's rank (1-based)
  const poolMemberCounts: Record<string, number> = {}; // comp_id → total members

  for (const comp of poolComps ?? []) {
    if (comp.status !== "complete") continue;
    const members = (poolMemberRows ?? [])
      .filter((r: any) => r.competition_id === comp.id)
      .map((r: any) => r.user_id);

    poolMemberCounts[comp.id] = members.length;

    const compPicks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const winsByMember: Record<string, number> = {};
    for (const m of members) winsByMember[m] = 0;
    for (const p of compPicks) {
      if (p.result === "win" && winsByMember[p.picker_id] !== undefined) {
        winsByMember[p.picker_id]++;
      }
    }

    const sorted = members.slice().sort((a: string, b: string) =>
      (winsByMember[b] ?? 0) - (winsByMember[a] ?? 0)
    );
    const rank = sorted.indexOf(user.id) + 1; // 1-based
    if (rank > 0) poolRanks[comp.id] = rank;
  }

  // ── Opponent profiles for 1v1 ──────────────────────────────────────────
  const opponentIds = Array.from(new Set(
    (v1Comps ?? [])
      .map((c) => c.creator_id === user.id ? c.opponent_id : c.creator_id)
      .filter(Boolean)
  ));
  const { data: opponentProfiles } = opponentIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", opponentIds)
    : { data: [] };
  const profileMap = new Map((opponentProfiles ?? []).map((p) => [p.id, p]));

  // ── 1v1 history ──────────────────────────────────────────────────────────
  const v1History = (v1Comps ?? []).map((comp) => {
    const compPicks  = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const myWins     = compPicks.filter((p) => p.picker_id === user.id && p.result === "win").length;
    const myLosses   = compPicks.filter((p) => p.picker_id === user.id && p.result === "loss").length;
    const opponentId = comp.creator_id === user.id ? comp.opponent_id : comp.creator_id;
    const opponent   = opponentId ? profileMap.get(opponentId) : null;
    const opponentName = opponent?.display_name ?? opponent?.email ?? null;
    const theirWins  = compPicks.filter((p) => p.picker_id === opponentId && p.result === "win").length;

    let outcome: "winning" | "losing" | "tied" | null = null;
    if (myWins + theirWins > 0) {
      outcome = myWins > theirWins ? "winning" : myWins < theirWins ? "losing" : "tied";
    }

    const durationLabel =
      comp.duration === "daily"   ? "Single day" :
      comp.duration === "weekly"  ? "1 week"     :
      comp.duration === "playoff" ? "Playoffs"   : "Full season";

    return { comp, myWins, myLosses, theirWins, outcome, opponentName, durationLabel };
  });

  // ── Pool history ────────────────────────────────────────────────────────
  const poolHistory = (poolComps ?? []).map((comp) => {
    const compPicks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const myWins    = compPicks.filter((p) => p.picker_id === user.id && p.result === "win").length;
    const myLosses  = compPicks.filter((p) => p.picker_id === user.id && p.result === "loss").length;
    const rank      = poolRanks[comp.id] ?? null;
    const members   = poolMemberCounts[comp.id] ?? (poolMemberRows ?? []).filter((r: any) => r.competition_id === comp.id).length;
    return { comp, myWins, myLosses, rank, members };
  });

  // ── Competition-level stats ──────────────────────────────────────────────
  // 1v1: win = finished with more wins than opponent
  const v1CompletedWins = v1History.filter((h) => h.comp.status === "complete" && h.outcome === "winning");
  const compWins = {
    daily:   v1CompletedWins.filter((h) => h.comp.duration === "daily").length,
    weekly:  v1CompletedWins.filter((h) => h.comp.duration === "weekly").length,
    season:  v1CompletedWins.filter((h) => h.comp.duration === "season").length,
    playoff: v1CompletedWins.filter((h) => h.comp.duration === "playoff").length,
  };
  const totalV1CompWins   = compWins.daily + compWins.weekly + compWins.season + compWins.playoff;
  const totalV1CompPlayed = v1History.filter((h) => h.comp.status === "complete" && h.outcome !== null).length;

  // Pool podium finishes (top 3)
  const podiumFinishes = Object.values(poolRanks).filter((r) => r <= 3).length;
  const totalPoolsPlayed = (poolComps ?? []).filter((c) => c.status === "complete").length;

  // ── Combine & sort history ───────────────────────────────────────────────
  const activeV1   = v1History.filter((h) => h.comp.status === "active" || h.comp.status === "pending");
  const pastV1     = v1History.filter((h) => h.comp.status === "complete" || h.comp.status === "cancelled");
  const activePool = poolHistory.filter((h) => h.comp.status === "active" || h.comp.status === "pending");
  const pastPool   = poolHistory.filter((h) => h.comp.status === "complete" || h.comp.status === "cancelled");

  const hasActive = activeV1.length > 0 || activePool.length > 0;
  const hasPast   = pastV1.length > 0   || pastPool.length > 0;

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Your profile</h1>

      <ProfileForm currentName={displayName} avatarUrl={avatarUrl} email={user.email ?? ""} />

      {/* ── Overall pick stats ── */}
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
              <div className="h-full bg-rink rounded-full transition-all" style={{ width: `${winRate ?? 0}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-1">{totalPicks} total picks across all competitions</p>
          </div>
        )}
      </section>

      {/* ── 1v1 competition wins ── */}
      {totalV1CompPlayed > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold mb-1">1v1 competition wins</h2>
          <p className="text-xs text-slate-500 mb-4">
            {totalV1CompWins}–{totalV1CompPlayed - totalV1CompWins} across {totalV1CompPlayed} completed competition{totalV1CompPlayed !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: "Daily",   count: compWins.daily },
              { label: "Weekly",  count: compWins.weekly },
              { label: "Season",  count: compWins.season },
              { label: "Playoff", count: compWins.playoff },
            ].map(({ label, count }) => (
              <div key={label}>
                <div className={`text-3xl font-bold ${count > 0 ? "text-rink" : "text-slate-300"}`}>{count}</div>
                <div className="text-xs text-slate-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Pool podium finishes ── */}
      {totalPoolsPlayed > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold mb-1">Pool podium finishes</h2>
          <p className="text-xs text-slate-500 mb-4">
            Top-3 finishes across {totalPoolsPlayed} completed pool{totalPoolsPlayed !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[1, 2, 3].map((place) => {
              const count = Object.values(poolRanks).filter((r) => r === place).length;
              return (
                <div key={place}>
                  <div className={`text-3xl font-bold ${count > 0 ? "text-rink" : "text-slate-300"}`}>
                    {count}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{PODIUM[place - 1]} {place === 1 ? "1st" : place === 2 ? "2nd" : "3rd"}</div>
                </div>
              );
            })}
          </div>
          {podiumFinishes > 0 && (
            <p className="text-xs text-slate-400 mt-3 text-center">{podiumFinishes} podium finish{podiumFinishes !== 1 ? "es" : ""} total</p>
          )}
        </section>
      )}

      {/* ── Competition history ── */}
      {(allComps.length > 0) && (
        <section>
          <h2 className="text-lg font-bold mb-3">Competition history</h2>

          {hasActive && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-500 mb-2">Active</h3>
              <ul className="space-y-2">
                {activeV1.map(({ comp, myWins, theirWins, outcome, opponentName, durationLabel }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span>{SPORT_EMOJI[comp.sport] ?? "🏒"}</span>
                            <span className="font-semibold text-rink truncate">{comp.name}</span>
                          </div>
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
                {activePool.map(({ comp, myWins, myLosses, rank }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span>{SPORT_EMOJI[comp.sport] ?? "🏒"}</span>
                            <span className="font-semibold text-rink truncate">{comp.name}</span>
                            <span className="text-xs bg-rink/10 text-rink px-1.5 py-0.5 rounded-full font-semibold">Pool</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{comp.start_date} → {comp.end_date}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold">{myWins}W {myLosses}L</div>
                          {rank && rank <= 3 && (
                            <div className="text-xs font-semibold text-amber-500">{PODIUM[rank - 1]} #{rank}</div>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasPast && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-2">Past</h3>
              <ul className="space-y-2">
                {pastV1.map(({ comp, myWins, theirWins, outcome, opponentName, durationLabel }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span>{SPORT_EMOJI[comp.sport] ?? "🏒"}</span>
                            <span className="font-semibold text-slate-700 truncate">{comp.name}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {durationLabel} · {comp.start_date}{opponentName ? ` · vs ${opponentName}` : ""}
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
                {pastPool.map(({ comp, myWins, myLosses, rank, members }) => (
                  <li key={comp.id}>
                    <Link href={`/competitions/${comp.id}`} className="card hover:shadow-md transition-shadow block">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span>{SPORT_EMOJI[comp.sport] ?? "🏒"}</span>
                            <span className="font-semibold text-slate-700 truncate">{comp.name}</span>
                            <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-semibold">Pool</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{comp.start_date} · {members} members</div>
                        </div>
                        <div className="text-right shrink-0">
                          {comp.status === "cancelled" ? (
                            <span className="text-xs text-slate-400 italic">Cancelled</span>
                          ) : (
                            <>
                              <div className="font-bold">{myWins}W {myLosses}L</div>
                              {rank && (
                                <div className={`text-xs font-semibold mt-0.5 ${rank <= 3 ? "text-amber-500" : "text-slate-400"}`}>
                                  {rank <= 3 ? PODIUM[rank - 1] : ""} #{rank} of {members}
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
