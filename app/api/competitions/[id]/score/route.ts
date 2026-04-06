import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate, isFinal, winnerAbbrev } from "@/lib/nhl";

// POST /api/competitions/:id/score
// Walks any pending picks and asks the NHL API for the result of each game.
// Updates the pick row with win/loss/push.
// Safe to call repeatedly. Cron-friendly.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { data: pending } = await supabase
    .from("picks")
    .select("*")
    .eq("competition_id", params.id)
    .eq("result", "pending");
  if (!pending || pending.length === 0) return NextResponse.json({ updated: 0 });

  // Group by date so we hit the NHL API once per date
  const byDate = new Map<string, typeof pending>();
  for (const p of pending) {
    const arr = byDate.get(p.game_date) ?? [];
    arr.push(p);
    byDate.set(p.game_date, arr);
  }

  let updated = 0;
  for (const [date, picks] of byDate) {
    let games;
    try { games = await fetchNHLScheduleForDate(date); } catch { continue; }
    for (const pick of picks) {
      const game = games.find((g) => g.id === pick.game_id);
      if (!game || !isFinal(game.gameState)) continue;
      const w = winnerAbbrev(game);
      let result: string;
      if (w == null) result = "push";
      else result = w === pick.picked_team_abbrev ? "win" : "loss";
      const { error } = await supabase
        .from("picks").update({ result }).eq("id", pick.id);
      if (!error) updated++;
    }
  }
  return NextResponse.json({ updated });
}
