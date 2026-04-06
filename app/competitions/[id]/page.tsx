import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate, isFinal, winnerAbbrev } from "@/lib/nhl";
import { generateDraftOrder, whoPicksFirst, type Player } from "@/lib/picks";
import PickRoom from "./PickRoom";

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default async function CompetitionPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: comp } = await supabase
    .from("competitions").select("*").eq("id", params.id).single();
  if (!comp) notFound();

  const isCreator = comp.creator_id === user.id;
  const isOpponent = comp.opponent_id === user.id;
  if (!isCreator && !isOpponent) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">Not a participant</h1>
        <p>You're not part of this competition. If you have an invite link, open it to join.</p>
      </div>
    );
  }

  // Look up profiles
  const ids = [comp.creator_id, comp.opponent_id].filter(Boolean);
  const { data: profiles } = await supabase.from("profiles").select("*").in("id", ids);
  const creatorProfile = profiles?.find((p) => p.id === comp.creator_id);
  const opponentProfile = profiles?.find((p) => p.id === comp.opponent_id);

  // The "active" date for picking. For daily comps it's the start_date.
  // For weekly/season we use today (clamped to the comp window).
  const today = todayISO();
  const activeDate =
    comp.duration === "daily" ? comp.start_date :
    today < comp.start_date ? comp.start_date :
    today > comp.end_date ? comp.end_date : today;

  // Pull schedule + existing picks for the active date
  let games: Awaited<ReturnType<typeof fetchNHLScheduleForDate>> = [];
  try { games = await fetchNHLScheduleForDate(activeDate); } catch {}

  const { data: allPicks } = await supabase
    .from("picks").select("*").eq("competition_id", comp.id);
  const todaysPicks = (allPicks ?? []).filter((p) => p.game_date === activeDate);

  // Compute prior records for who-picks-first
  const recordA = { wins: 0, losses: 0, pushes: 0 };
  const recordB = { wins: 0, losses: 0, pushes: 0 };
  for (const p of allPicks ?? []) {
    if (p.game_date >= activeDate) continue;
    const rec = p.picker_id === comp.creator_id ? recordA : recordB;
    if (p.result === "win") rec.wins++;
    else if (p.result === "loss") rec.losses++;
    else if (p.result === "push") rec.pushes++;
  }

  // Previous date's first picker (for tiebreaker fallback)
  const prevDates = Array.from(new Set((allPicks ?? [])
    .filter((p) => p.game_date < activeDate)
    .map((p) => p.game_date))).sort();
  const prevDate = prevDates[prevDates.length - 1];
  let previousFirstPicker: Player | null = null;
  if (prevDate) {
    const firstPickRow = (allPicks ?? [])
      .filter((p) => p.game_date === prevDate)
      .sort((a, b) => a.pick_index - b.pick_index)[0];
    if (firstPickRow) {
      previousFirstPicker = firstPickRow.picker_id === comp.creator_id ? "A" : "B";
    }
  }

  const firstPicker = whoPicksFirst(recordA, recordB, previousFirstPicker, "A");
  // For now we don't ask the better-record player to defer; default to no defer.
  // (TODO: surface a deferral toggle in the UI before any pick is made.)
  const draft = generateDraftOrder({ numGames: games.length, firstPicker, deferred: false });

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold">{comp.name}</h1>
            <p className="text-sm text-slate-500">
              {comp.duration} · {comp.start_date} → {comp.end_date}
            </p>
          </div>
          <div className="text-right text-sm">
            <div><b>{creatorProfile?.display_name ?? "Creator"}</b> (creator)</div>
            <div>{opponentProfile?.display_name ?? <span className="italic text-slate-400">awaiting opponent…</span>}</div>
          </div>
        </div>
        {!comp.opponent_id && (
          <div className="mt-4 rounded-lg bg-ice p-3 text-sm">
            Share this invite link with your friend:&nbsp;
            <code className="bg-white px-2 py-1 rounded">
              {process.env.NEXT_PUBLIC_SITE_URL}/join/{comp.invite_token}
            </code>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-lg font-bold mb-1">Tonight's slate · {activeDate}</h2>
        <p className="text-sm text-slate-500 mb-4">
          {games.length} games · first pick: <b>{firstPicker === "A"
            ? creatorProfile?.display_name ?? "Creator"
            : opponentProfile?.display_name ?? "Opponent"}</b>
          {draft.unpickedGames > 0 && <> · {draft.unpickedGames} game(s) will be left unpicked</>}
        </p>

        <PickRoom
          competitionId={comp.id}
          activeDate={activeDate}
          games={games.map((g) => ({
            id: g.id,
            home: g.homeTeam,
            away: g.awayTeam,
            startTimeUTC: g.startTimeUTC,
            final: isFinal(g.gameState),
            winner: winnerAbbrev(g),
          }))}
          existingPicks={todaysPicks}
          draftOrder={draft.order}
          playerAId={comp.creator_id}
          playerBId={comp.opponent_id}
          currentUserId={user.id}
        />
      </div>

      <Standings recordA={recordA} recordB={recordB}
        nameA={creatorProfile?.display_name ?? "Creator"}
        nameB={opponentProfile?.display_name ?? "Opponent"} />
    </div>
  );
}

function Standings({ recordA, recordB, nameA, nameB }: any) {
  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-3">Standings (prior to today)</h2>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>Player</th><th>W</th><th>L</th><th>P</th></tr></thead>
        <tbody>
          <tr><td>{nameA}</td><td>{recordA.wins}</td><td>{recordA.losses}</td><td>{recordA.pushes}</td></tr>
          <tr><td>{nameB}</td><td>{recordB.wins}</td><td>{recordB.losses}</td><td>{recordB.pushes}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
