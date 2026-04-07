import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateDraftOrder, whoPicksFirst, type Player } from "@/lib/picks";

function todayISO() { return new Date().toISOString().slice(0, 10); }

type BadgeStyle = { label: string; color: string };

function getStatusBadge(
  comp: any,
  myId: string,
  myWins: number, myLosses: number,
  theirWins: number, theirLosses: number,
  isMyTurnTonight: boolean,
): BadgeStyle {
  if (comp.status === "cancelled") {
    return { label: "Cancelled", color: "bg-slate-100 text-slate-500" };
  }
  if (comp.status === "pending" && !comp.opponent_id) {
    return { label: "Awaiting opponent", color: "bg-yellow-100 text-yellow-800" };
  }
  if (comp.status === "complete") {
    if (myWins > theirWins) return { label: "You won!", color: "bg-green-100 text-green-800" };
    if (myWins < theirWins) return { label: "You lost", color: "bg-red-100 text-red-700" };
    return { label: "Tied", color: "bg-slate-100 text-slate-600" };
  }
  if (isMyTurnTonight) {
    return { label: "Your turn to pick", color: "bg-rink text-white" };
  }
  return { label: "Waiting on opponent", color: "bg-slate-100 text-slate-600" };
}

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let enriched: any[] = [];

  if (user) {
    const { data: competitions } = await supabase
      .from("competitions")
      .select("*")
      .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (competitions && competitions.length > 0) {
      // Fetch all picks for all competitions in one query.
      const compIds = competitions.map((c) => c.id);
      const { data: allPicks } = await supabase
        .from("picks")
        .select("competition_id, picker_id, result, game_date, pick_index")
        .in("competition_id", compIds);

      // Fetch opponent profiles.
      const opponentIds = competitions
        .map((c) => (c.creator_id === user.id ? c.opponent_id : c.creator_id))
        .filter(Boolean);
      const { data: profiles } = opponentIds.length > 0
        ? await supabase.from("profiles").select("id, display_name").in("id", opponentIds)
        : { data: [] };

      const today = todayISO();

      enriched = competitions.map((comp) => {
        const picks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);
        const isCreator = comp.creator_id === user.id;
        const opponentId = isCreator ? comp.opponent_id : comp.creator_id;
        const opponentProfile = (profiles ?? []).find((p) => p.id === opponentId);

        // W/L for each player.
        let myWins = 0, myLosses = 0, theirWins = 0, theirLosses = 0;
        let myWinsTonight = 0, myLossesTonight = 0, theirWinsTonight = 0, theirLossesTonight = 0;
        for (const p of picks) {
          const mine = p.picker_id === user.id;
          if (p.result === "win") mine ? myWins++ : theirWins++;
          if (p.result === "loss") mine ? myLosses++ : theirLosses++;
          // Tonight's picks
          if (p.game_date === today) {
            if (p.result === "win") mine ? myWinsTonight++ : theirWinsTonight++;
            if (p.result === "loss") mine ? myLossesTonight++ : theirLossesTonight++;
          }
        }
        const hasPicksTonight = myWinsTonight + myLossesTonight + theirWinsTonight + theirLossesTonight > 0;

        // Is it my turn tonight?
        let isMyTurnTonight = false;
        if (comp.opponent_id && comp.status === "active") {
          const activeDate =
            comp.duration === "daily" ? comp.start_date :
            today < comp.start_date ? comp.start_date :
            today > comp.end_date ? comp.end_date : today;

          const todaysPicks = picks.filter((p) => p.game_date === activeDate);

          // Recompute first picker from prior records.
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
              .sort((a, b) => a.pick_index - b.pick_index)[0];
            if (fp) prevFirstPicker = fp.picker_id === comp.creator_id ? "A" : "B";
          }
          const firstPickerSlot = whoPicksFirst(recordA, recordB, prevFirstPicker, "A");
          // We don't know the game count here without an API call, so use a
          // placeholder order length of 10 to determine whose turn it is.
          const nextIndex = todaysPicks.length;
          // Simple turn check: even indices go to first picker, odd to second
          // (approximation — exact order computed on the comp page).
          const onTheClock = nextIndex % 2 === 0 ? firstPickerSlot : (firstPickerSlot === "A" ? "B" : "A");
          const onTheClockUserId = onTheClock === "A" ? comp.creator_id : comp.opponent_id;
          isMyTurnTonight = onTheClockUserId === user.id;
        }

        return {
          ...comp,
          myWins, myLosses, theirWins, theirLosses,
          myWinsTonight, myLossesTonight, theirWinsTonight, theirLossesTonight,
          hasPicksTonight,
          opponentName: opponentProfile?.display_name ?? (comp.opponent_id ? "Opponent" : null),
          isMyTurnTonight,
        };
      });
    }
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
          <Link href="/login" className="btn-primary mt-4 inline-block">Sign in to start</Link>
        )}
      </section>

      {user && (
        <CompetitionsList enriched={enriched} userId={user.id} />
      )}
    </div>
  );
}

function CompetitionCard({ c, userId }: { c: any; userId: string }) {
  const badge = getStatusBadge(
    c, userId, c.myWins, c.myLosses, c.theirWins, c.theirLosses, c.isMyTurnTonight,
  );
  const durationLabel =
    c.duration === "daily" ? "Single day" :
    c.duration === "weekly" ? "1 week" : "Full season";

  return (
    <li className="card hover:shadow-md transition-shadow">
      <Link href={`/competitions/${c.id}`} className="block">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="font-semibold text-rink hover:underline leading-tight">{c.name}</span>
          <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${badge.color}`}>
            {badge.label}
          </span>
        </div>

        <div className="text-xs text-slate-500 mb-3">
          🏒 NHL · {durationLabel} · {c.start_date}
          {c.duration !== "daily" && ` → ${c.end_date}`}
        </div>

        {c.opponentName ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="text-center">
                <div className="text-xs text-slate-500 mb-0.5">You</div>
                <div className="font-bold text-lg leading-none">{c.myWins}–{c.myLosses}</div>
              </div>
              <div className="text-xs text-slate-400 font-medium">Overall</div>
              <div className="text-center">
                <div className="text-xs text-slate-500 mb-0.5">{c.opponentName}</div>
                <div className="font-bold text-lg leading-none">{c.theirWins}–{c.theirLosses}</div>
              </div>
            </div>
            {c.hasPicksTonight && c.duration !== "daily" && c.status !== "complete" && (
              <div className="flex items-center justify-between rounded-lg bg-ice px-3 py-1.5 text-sm">
                <div className="font-semibold tabular-nums">{c.myWinsTonight}–{c.myLossesTonight}</div>
                <div className="text-xs text-rink font-medium">Tonight</div>
                <div className="font-semibold tabular-nums">{c.theirWinsTonight}–{c.theirLossesTonight}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic">
            No opponent yet — share your invite link
          </div>
        )}
      </Link>
    </li>
  );
}

function CompetitionsList({ enriched, userId }: { enriched: any[]; userId: string }) {
  const active = enriched.filter((c) => c.status !== "complete" && c.status !== "cancelled");
  const past = enriched.filter((c) => c.status === "complete" || c.status === "cancelled");

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">Your competitions</h2>
          <Link href="/competitions/new" className="btn-primary">+ New</Link>
        </div>
        {active.length === 0 ? (
          <p className="text-slate-500">No active competitions. Create one to get started.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((c) => <CompetitionCard key={c.id} c={c} userId={userId} />)}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-3 text-slate-500">Past competitions</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {past.map((c) => <CompetitionCard key={c.id} c={c} userId={userId} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
