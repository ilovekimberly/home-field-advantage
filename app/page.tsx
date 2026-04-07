import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { whoPicksFirst, type Player } from "@/lib/picks";
import { CompetitionsList } from "./CompetitionsList";

function todayISO() { return new Date().toISOString().slice(0, 10); }


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

