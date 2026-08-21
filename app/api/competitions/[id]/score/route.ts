import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame, scorePick } from "@/lib/schedule";

// POST /api/competitions/:id/score
// Walks any pending picks and asks the sport's API for the result of each game.
// Updates the pick row with win/loss/push.
// Safe to call repeatedly. Cron-friendly.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  // Admin client: pool members are neither creator nor opponent, so RLS blocks
  // them from reading the competition row or updating other members' picks.
  const admin = createSupabaseAdminClient();

  const { data: comp } = await admin
    .from("competitions")
    .select("id, sport")
    .eq("id", params.id)
    .single();
  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sport = comp.sport ?? "NHL";

  // Include "unscored" as well as "pending". A pick gets marked unscored when
  // the cron couldn't resolve its game (e.g. a schedule-API week-lookup bug).
  // Those are recoverable — if the game is findable and final now, score it.
  const { data: pending } = await admin
    .from("picks")
    .select("*")
    .eq("competition_id", params.id)
    .in("result", ["pending", "unscored"]);
  if (!pending || pending.length === 0) return NextResponse.json({ updated: 0 });

  // Group by date so we hit the schedule API once per date
  const byDate = new Map<string, typeof pending>();
  for (const p of pending) {
    const arr = byDate.get(p.game_date) ?? [];
    arr.push(p);
    byDate.set(p.game_date, arr);
  }

  let updated = 0;
  for (const [date, picks] of byDate) {
    let games;
    try { games = await fetchScheduleForDate(sport, date, true); } catch { continue; }
    for (const pick of picks) {
      const game = games.find((g) => String(g.id) === String(pick.game_id));
      if (!game || !isFinalGame(game)) continue;

      // Draw-aware for EPL/FIFA; tie = push for everything else.
      const result = scorePick(sport, game, pick.picked_team_abbrev);
      if (result === null) continue; // not resolved yet

      const { error } = await admin
        .from("picks").update({ result }).eq("id", pick.id);
      if (!error) updated++;
    }
  }
  return NextResponse.json({ updated });
}
