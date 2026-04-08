import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { whoPicksFirst, type Player } from "@/lib/picks";

function todayISO() { return new Date().toISOString().slice(0, 10); }

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="max-w-2xl space-y-10">
        {/* Hero */}
        <section className="text-center py-8">
          <h1 className="text-4xl font-bold text-rink mb-4">🏒 Home Field Advantage</h1>
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
            { emoji: "📊", title: "Auto scoring", desc: "Results come in automatically. No manual updating required." },
            { emoji: "🏒⚾⚽", title: "3 sports", desc: "NHL, MLB, and the Premier League. More coming soon." },
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

  // Fetch all competitions.
  const { data: competitions } = await supabase
    .from("competitions")
    .select("*")
    .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  const compIds = (competitions ?? []).map((c) => c.id);

  // Fetch recent picks (last 14 days) across all competitions.
  const { data: recentPicks } = compIds.length > 0
    ? await supabase
        .from("picks")
        .select("*")
        .in("competition_id", compIds)
        .gte("game_date", twoWeeksAgo)
        .order("game_date", { ascending: false })
    : { data: [] };

  // Fetch all picks (for turn calculation — just today's).
  const { data: todaysPicks } = compIds.length > 0
    ? await supabase
        .from("picks")
        .select("*")
        .in("competition_id", compIds)
        .eq("game_date", today)
    : { data: [] };

  // Fetch all prior picks for turn calculation.
  const { data: allPicks } = compIds.length > 0
    ? await supabase
        .from("picks")
        .select("competition_id, picker_id, result, game_date, pick_index")
        .in("competition_id", compIds)
    : { data: [] };

  // Fetch profiles for all participants.
  const allUserIds = Array.from(new Set(
    (competitions ?? []).flatMap((c) => [c.creator_id, c.opponent_id].filter(Boolean))
  ));
  const { data: profiles } = allUserIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", allUserIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // ── Determine which active competitions need my pick tonight ──────────
  const activeComps = (competitions ?? []).filter(
    (c) => c.status === "active" && c.opponent_id
  );

  const needsMyPick: { comp: any; opponentName: string }[] = [];

  for (const comp of activeComps) {
    const picks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
    const activeDate =
      comp.duration === "daily" ? comp.start_date :
      today < comp.start_date ? comp.start_date :
      today > comp.end_date ? comp.end_date : today;

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
    const onTheClock = nextIndex % 2 === 0 ? firstPickerSlot : (firstPickerSlot === "A" ? "B" : "A");
    const onTheClockUserId = onTheClock === "A" ? comp.creator_id : comp.opponent_id;

    if (onTheClockUserId === user.id) {
      const opponentId = comp.creator_id === user.id ? comp.opponent_id : comp.creator_id;
      const opponentProfile = profileMap.get(opponentId);
      needsMyPick.push({
        comp,
        opponentName: opponentProfile?.display_name ?? opponentProfile?.email ?? "Opponent",
      });
    }
  }

  // ── Build activity feed ───────────────────────────────────────────────
  type FeedItem = {
    date: string;
    icon: string;
    text: string;
    compName: string;
    compId: string;
    result?: string;
  };

  const feed: FeedItem[] = [];

  for (const pick of recentPicks ?? []) {
    const comp = (competitions ?? []).find((c) => c.id === pick.competition_id);
    if (!comp) continue;
    const picker = profileMap.get(pick.picker_id);
    const pickerName = pick.picker_id === user.id ? "You" : (picker?.display_name ?? picker?.email ?? "Opponent");
    const verb = pick.picker_id === user.id ? "picked" : "picked";

    let icon = "🏒";
    let resultSuffix = "";
    if (pick.result === "win") { icon = "✅"; resultSuffix = " — Won!"; }
    else if (pick.result === "loss") { icon = "❌"; resultSuffix = " — Lost"; }
    else if (pick.result === "push") { icon = "🤝"; resultSuffix = " — Push"; }

    feed.push({
      date: pick.game_date,
      icon,
      text: `${pickerName} ${verb} ${pick.picked_team_abbrev}${resultSuffix}`,
      compName: comp.name,
      compId: comp.id,
      result: pick.result,
    });
  }

  // Sort feed by date desc, limit to 30.
  feed.sort((a, b) => b.date.localeCompare(a.date));
  const feedItems = feed.slice(0, 30);

  // Group feed by date.
  const feedByDate: Record<string, FeedItem[]> = {};
  for (const item of feedItems) {
    if (!feedByDate[item.date]) feedByDate[item.date] = [];
    feedByDate[item.date].push(item);
  }
  const feedDates = Object.keys(feedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Quick pick prompt ── */}
      {needsMyPick.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">🎯 Your turn to pick</h2>
          <div className="space-y-2">
            {needsMyPick.map(({ comp, opponentName }) => (
              <Link
                key={comp.id}
                href={`/competitions/${comp.id}`}
                className="flex items-center justify-between rounded-xl bg-rink text-white px-5 py-4 hover:bg-rink/90 transition-colors shadow"
              >
                <div>
                  <div className="font-semibold text-base">{comp.name}</div>
                  <div className="text-sm text-white/70 mt-0.5">vs {opponentName}</div>
                </div>
                <span className="text-2xl">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── No active comps nudge ── */}
      {activeComps.length === 0 && (competitions ?? []).length === 0 && (
        <section className="card text-center py-10">
          <p className="text-slate-500 mb-4">No competitions yet. Challenge a friend to get started.</p>
          <Link href="/competitions/new" className="btn-primary">Create a competition</Link>
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

      {/* ── Empty feed ── */}
      {feedDates.length === 0 && (competitions ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Recent activity</h2>
          <p className="text-slate-400 text-sm">No picks in the last 2 weeks. Activity will show up here once games are played.</p>
        </section>
      )}
    </div>
  );
}
