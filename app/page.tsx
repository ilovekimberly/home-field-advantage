import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { whoPicksFirst, generateDraftOrder, type Player, type DraftStyle } from "@/lib/picks";
import { fetchScheduleForDate, getPickDate } from "@/lib/schedule";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const SPORT_EMOJI: Record<string, string> = { NHL: "🏒", MLB: "⚾", EPL: "⚽", FIFA: "🏆", NFL: "🏈" };

function getStatusBadge(comp: any): { label: string; className: string } {
  const isGroupComp = comp.format === "pool" || comp.format === "survivor";
  switch (comp.status) {
    case "active":    return { label: "Active",                                                className: "bg-green-100 text-green-700" };
    case "pending":   return { label: isGroupComp ? "Awaiting members" : "Awaiting opponent", className: "bg-amber-100 text-amber-700" };
    case "complete":  return { label: "Complete",                                              className: "bg-slate-100 text-slate-500" };
    case "cancelled": return { label: "Cancelled",                                             className: "bg-red-100 text-red-400" };
    default:          return { label: comp.status,                                             className: "bg-slate-100 text-slate-500" };
  }
}

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="max-w-2xl space-y-10">
        {/* Hero */}
        <section className="text-center py-8">
          <h1 className="text-4xl font-bold text-rink mb-4">🏒 My Home Field</h1>
          <p className="text-slate-600 text-xl leading-relaxed mb-8 max-w-lg mx-auto">
            1v1 pick'em competitions with your friends. Draft game picks, track the scores, settle the debate.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/login" className="btn-primary text-lg px-8 py-3">Sign in to start</Link>
            <Link href="/how-it-works" className="btn-ghost text-lg px-6 py-3">How it works →</Link>
          </div>
        </section>

        {/* Feature highlights */}
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { emoji: "🐍", title: "Snake draft picks", desc: "Take turns picking games each night. Better record picks first." },
            { emoji: "📊", title: "Auto scoring",      desc: "Results come in automatically. No manual updating required." },
            { emoji: "🏒⚾⚽", title: "3 sports",     desc: "NHL, MLB, and the Premier League. More coming soon." },
          ].map((f) => (
            <div key={f.title} className="card text-center">
              <div className="text-3xl mb-2">{f.emoji}</div>
              <div className="font-semibold mb-1">{f.title}</div>
              <div className="text-sm text-slate-500">{f.desc}</div>
            </div>
          ))}
        </section>
      </div>
    );
  }

  const today = todayISO();
  const twoWeeksAgo = daysAgo(14);

  // Friends' public competitions
  const { data: friendships } = await supabase
    .from("friendships")
    .select("requester_id, addressee_id")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq("status", "accepted");
  const friendIds = (friendships ?? []).map((f) =>
    f.requester_id === user.id ? f.addressee_id : f.requester_id
  );
  const { data: friendComps } = friendIds.length > 0
    ? await supabase
        .from("competitions")
        .select("id, name, sport, status, start_date, creator_id")
        .in("creator_id", friendIds)
        .eq("visibility", "friends")
        .in("status", ["active", "pending"])
        .order("start_date", { ascending: false })
    : { data: [] };

  // Get friend profiles for display
  const { data: friendProfiles } = friendIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", friendIds)
    : { data: [] };
  const friendProfileMap = new Map((friendProfiles ?? []).map((p) => [p.id, p]));

  // Load competitions where user is creator, 1v1 opponent, OR pool member.
  const { data: memberRows } = await supabase
    .from("competition_members")
    .select("competition_id")
    .eq("user_id", user.id);
  const poolCompIds = (memberRows ?? []).map((r: any) => r.competition_id);

  const { data: competitions } = await supabase
    .from("competitions")
    .select("*")
    .or(
      poolCompIds.length > 0
        ? `creator_id.eq.${user.id},opponent_id.eq.${user.id},id.in.(${poolCompIds.join(",")})`
        : `creator_id.eq.${user.id},opponent_id.eq.${user.id}`
    )
    .order("created_at", { ascending: false });

  const compIds = (competitions ?? []).map((c) => c.id);

  const { data: recentPicks } = compIds.length > 0
    ? await supabase.from("picks").select("*")
        .in("competition_id", compIds)
        .gte("game_date", twoWeeksAgo)
        .order("game_date", { ascending: false })
    : { data: [] };

  const { data: allPicks } = compIds.length > 0
    ? await supabase.from("picks")
        .select("competition_id, picker_id, result, game_date, pick_index, game_id")
        .in("competition_id", compIds)
    : { data: [] };

  const allUserIds = Array.from(new Set(
    (competitions ?? []).flatMap((c) => [c.creator_id, c.opponent_id].filter(Boolean))
  ));
  const { data: profiles } = allUserIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", allUserIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // ── Which active competitions need my pick tonight ─────────────────────
  // Pool competitions are excluded — everyone picks independently on their own schedule.
  const activeComps = (competitions ?? []).filter(
    (c) => c.status === "active" && c.opponent_id && c.format !== "pool" && c.format !== "survivor"
  );

  // Compute the active date for each comp, then batch-fetch schedules grouped
  // by (sport, date) so we only hit the schedule API once per pair.
  const compActiveDates: Record<string, string> = {};
  for (const comp of activeComps) {
    const raw =
      comp.duration === "daily" ? comp.start_date :
      today < comp.start_date ? comp.start_date :
      today > comp.end_date ? comp.end_date : today;
    compActiveDates[comp.id] = getPickDate(comp.sport ?? "NHL", raw);
  }

  const sportDatePairs = Array.from(
    new Set(activeComps.map((c) => `${c.sport ?? "NHL"}__${compActiveDates[c.id]}`))
  );
  const gamesMap: Record<string, any[]> = {};
  await Promise.all(
    sportDatePairs.map(async (pair) => {
      const [sport, date] = pair.split("__");
      try {
        gamesMap[pair] = await fetchScheduleForDate(sport, date);
      } catch {
        gamesMap[pair] = []; // unknown — don't falsely flag "Your turn"
      }
    })
  );

  const needsMyPick: { comp: any; opponentName: string }[] = [];

  for (const comp of activeComps) {
    const activeDate = compActiveDates[comp.id];
    const picks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const dayPicks = picks.filter((p) => p.game_date === activeDate);

    const recordA = { wins: 0, losses: 0, pushes: 0 };
    const recordB = { wins: 0, losses: 0, pushes: 0 };
    for (const p of picks) {
      if (p.game_date >= activeDate) continue;
      const rec = p.picker_id === comp.creator_id ? recordA : recordB;
      if (p.result === "win") rec.wins++;
      else if (p.result === "loss") rec.losses++;
    }
    const prevDates = Array.from(new Set(
      picks.filter((p) => p.game_date < activeDate).map((p) => p.game_date)
    )).sort();
    const prevDate = prevDates[prevDates.length - 1];
    let prevFirstPicker: Player | null = null;
    if (prevDate) {
      const fp = picks
        .filter((p) => p.game_date === prevDate)
        .sort((a: any, b: any) => a.pick_index - b.pick_index)[0];
      if (fp) prevFirstPicker = fp.picker_id === comp.creator_id ? "A" : "B";
    }
    const firstPickerSlot = whoPicksFirst(recordA, recordB, prevFirstPicker, "A");
    const nextIndex = dayPicks.length;

    let deferred = false;
    if (dayPicks.length > 0) {
      const firstPick = [...dayPicks].sort((a: any, b: any) => a.pick_index - b.pick_index)[0];
      const firstPickSlot = firstPick.picker_id === comp.creator_id ? "A" : "B";
      deferred = firstPickSlot !== firstPickerSlot;
    }

    // Mirror the picks API's effectiveGameCount: only count games that are either
    // already picked today OR haven't started yet. This prevents "Your turn" from
    // firing after all picks are done when some games started before picking began.
    const now = new Date();
    const todayGames = gamesMap[`${comp.sport ?? "NHL"}__${activeDate}`] ?? [];
    const pickedGameIds = new Set(dayPicks.map((p: any) => String(p.game_id)));
    const effectiveGameCount = todayGames.filter(
      (g: any) => pickedGameIds.has(String(g.id)) || new Date(g.startTimeUTC) > now
    ).length;

    const draft = generateDraftOrder({
      numGames: effectiveGameCount,
      firstPicker: firstPickerSlot,
      deferred,
      draftStyle: (comp.draft_style ?? "standard") as DraftStyle,
    });

    const onTheClock = nextIndex < draft.order.length ? draft.order[nextIndex] : null;
    const onTheClockUserId = onTheClock === "A" ? comp.creator_id : comp.opponent_id;
    const isStale = activeDate < today;

    if (!isStale && onTheClock && onTheClockUserId === user.id) {
      const opponentId = comp.creator_id === user.id ? comp.opponent_id : comp.creator_id;
      const opponentProfile = profileMap.get(opponentId);
      needsMyPick.push({
        comp,
        opponentName: opponentProfile?.display_name ?? opponentProfile?.email ?? "Opponent",
      });
    }
  }

  // ── Standings per competition ──────────────────────────────────────────
  const compStandings: Record<string, { myWins: number; myLosses: number; theirWins: number; theirLosses: number }> = {};
  for (const comp of competitions ?? []) {
    let myWins = 0, myLosses = 0, theirWins = 0, theirLosses = 0;
    for (const p of allPicks ?? []) {
      if (p.competition_id !== comp.id || !p.result || p.result === "unscored") continue;
      const mine = p.picker_id === user.id;
      if (p.result === "win")  mine ? myWins++    : theirWins++;
      if (p.result === "loss") mine ? myLosses++  : theirLosses++;
    }
    compStandings[comp.id] = { myWins, myLosses, theirWins, theirLosses };
  }

  // Sort: urgent (active + my turn) → active → pending → complete → cancelled
  const urgencyScore = (c: any) => {
    if (c.status === "cancelled") return 5;
    if (c.status === "complete")  return 4;
    if (c.status === "pending")   return 3;
    if (needsMyPick.some((n) => n.comp.id === c.id)) return 1;
    return 2;
  };
  const sortedComps = [...(competitions ?? [])].sort((a, b) => urgencyScore(a) - urgencyScore(b));
  const visibleComps = sortedComps.filter((c) => c.status !== "cancelled");

  // ── Activity feed ──────────────────────────────────────────────────────
  type FeedItem = { date: string; icon: string; text: string; compName: string; compId: string };
  const feed: FeedItem[] = [];

  for (const pick of recentPicks ?? []) {
    const comp = (competitions ?? []).find((c) => c.id === pick.competition_id);
    if (!comp) continue;
    const picker = profileMap.get(pick.picker_id);
    const pickerName = pick.picker_id === user.id ? "You" : (picker?.display_name ?? picker?.email ?? "Opponent");
    let icon = SPORT_EMOJI[comp.sport ?? "NHL"] ?? "🏒";
    let resultSuffix = "";
    if (pick.result === "win")  { icon = "✅"; resultSuffix = " — Won!"; }
    if (pick.result === "loss") { icon = "❌"; resultSuffix = " — Lost"; }
    if (pick.result === "push") { icon = "🤝"; resultSuffix = " — Push"; }

    // Humanize FIFA outcome labels: HOME/AWAY/DRAW → readable
    let pickLabel = pick.picked_team_abbrev;
    if (comp.sport === "FIFA") {
      if (pickLabel === "HOME") pickLabel = `${pick.picked_team_name} (home) to win`;
      else if (pickLabel === "AWAY") pickLabel = `${pick.picked_team_name} (away) to win`;
      else if (pickLabel === "DRAW") pickLabel = "Draw";
    }

    feed.push({
      date: pick.game_date,
      icon,
      text: `${pickerName} picked ${pickLabel}${resultSuffix}`,
      compName: comp.name,
      compId: comp.id,
    });
  }

  feed.sort((a, b) => b.date.localeCompare(a.date));
  const feedItems = feed.slice(0, 30);
  const feedByDate: Record<string, FeedItem[]> = {};
  for (const item of feedItems) {
    if (!feedByDate[item.date]) feedByDate[item.date] = [];
    feedByDate[item.date].push(item);
  }
  const feedDates = Object.keys(feedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── No competitions yet ── */}
      {(competitions ?? []).length === 0 && (
        <section className="card text-center py-10">
          <p className="text-slate-500 mb-4">No competitions yet. Challenge a friend to get started.</p>
          <Link href="/competitions/new" className="btn-primary">Create a competition</Link>
        </section>
      )}

      {/* ── Competitions dashboard ── */}
      {visibleComps.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Your competitions</h2>
            <Link href="/competitions/new" className="btn-primary text-sm py-1.5 px-3">+ New</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleComps.map((comp) => {
              const isPool     = comp.format === "pool";
              const isSurvivor = comp.format === "survivor";
              const s = compStandings[comp.id] ?? { myWins: 0, myLosses: 0, theirWins: 0, theirLosses: 0 };
              const myTurn = needsMyPick.some((n) => n.comp.id === comp.id);
              const opponentId = comp.creator_id === user.id ? comp.opponent_id : comp.creator_id;
              const opponent = opponentId ? profileMap.get(opponentId) : null;
              const opponentName = opponent?.display_name ?? opponent?.email ?? null;
              const emoji = SPORT_EMOJI[comp.sport ?? "NHL"] ?? "🏒";
              const badge = getStatusBadge(comp);
              const totalPicks = s.myWins + s.myLosses;
              const diff = s.myWins - s.theirWins;
              const standingLabel =
                totalPicks === 0 ? null :
                diff > 0 ? `Up ${diff}` :
                diff < 0 ? `Down ${Math.abs(diff)}` : "Tied";

              return (
                <Link
                  key={comp.id}
                  href={`/competitions/${comp.id}`}
                  className={`card hover:shadow-md transition-all flex flex-col gap-3 ${
                    myTurn ? "ring-2 ring-rink" : ""
                  }`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xl shrink-0">{emoji}</span>
                      <span className="font-semibold text-slate-800 leading-snug truncate">{comp.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPool && (
                        <span className="text-xs bg-rink/10 text-rink px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                          Pool
                        </span>
                      )}
                      {isSurvivor && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                          🏈 Survivor
                        </span>
                      )}
                      {myTurn && (
                        <span className="text-xs bg-rink text-white px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                          Your turn
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  {/* Subtitle */}
                  {(isPool || isSurvivor) ? (
                    <div className="text-sm text-slate-500">
                      {isSurvivor ? "NFL Survivor league" : "Group competition"} · {comp.start_date}
                      {comp.duration !== "daily" && ` → ${comp.end_date}`}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">
                      {opponentName ? `vs ${opponentName}` : (
                        <span className="italic text-slate-400">Awaiting opponent</span>
                      )}
                    </div>
                  )}

                  {/* Record */}
                  {!isPool && totalPicks > 0 && (
                    <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-sm">
                      <span className="font-bold text-green-700">{s.myWins}W</span>
                      <span className="font-bold text-red-500">{s.myLosses}L</span>
                      {standingLabel && (
                        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
                          diff > 0 ? "bg-green-50 text-green-700" :
                          diff < 0 ? "bg-red-50 text-red-500" :
                          "bg-slate-100 text-slate-500"
                        }`}>
                          {standingLabel}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Pool: show my record only */}
                  {isPool && totalPicks > 0 && (
                    <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-sm">
                      <span className="font-bold text-green-700">{s.myWins}W</span>
                      <span className="font-bold text-red-500">{s.myLosses}L</span>
                      <span className="ml-auto text-xs text-slate-400">my picks</span>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Friends' competitions ── */}
      {(friendComps ?? []).length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Friends' competitions</h2>
            <Link href="/friends" className="text-sm text-rink hover:underline">View friends →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(friendComps ?? []).map((comp) => {
              const friend = friendProfileMap.get(comp.creator_id);
              const friendName = friend?.display_name ?? friend?.email ?? "Friend";
              const emoji = SPORT_EMOJI[comp.sport ?? "NHL"] ?? "🏒";
              return (
                <Link
                  key={comp.id}
                  href={`/competitions/${comp.id}`}
                  className="card hover:shadow-md transition-all flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{emoji}</span>
                    <span className="font-semibold text-slate-800 truncate">{comp.name}</span>
                    {comp.status === "active" && (
                      <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">Live</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{friendName}'s competition</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Activity feed ── */}
      {feedDates.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-4">Recent activity</h2>
          <div className="space-y-6">
            {feedDates.map((date) => (
              <div key={date}>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  {date === today ? "Today" : date === daysAgo(1) ? "Yesterday" : date}
                </div>
                <ul className="space-y-1">
                  {feedByDate[date].map((item, i) => (
                    <li key={i}>
                      <Link
                        href={`/competitions/${item.compId}`}
                        className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-base mt-0.5">{item.icon}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-slate-800">{item.text}</span>
                          <span className="text-xs text-slate-400 ml-2">· {item.compName}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {feedDates.length === 0 && (competitions ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Recent activity</h2>
          <p className="text-slate-400 text-sm">No picks in the last 2 weeks. Activity will show up here once games are played.</p>
        </section>
      )}

    </div>
  );
}
