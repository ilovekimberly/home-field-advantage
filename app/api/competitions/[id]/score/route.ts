import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame, winnerAbbrevGame } from "@/lib/schedule";
import { fifaOutcome } from "@/lib/fifa";

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

  const { data: pending } = await admin
    .from("picks")
    .select("*")
    .eq("competition_id", params.id)
    .eq("result", "pending");
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

      let result: string;
      if (sport === "FIFA") {
        const outcome = fifaOutcome(game);
        if (outcome === null) continue; // not resolved yet
        result = outcome === pick.picked_team_abbrev ? "win" : "loss";
      } else {
        const w = winnerAbbrevGame(game);
        result = w == null ? "push"
          : w === pick.picked_team_abbrev ? "win" : "loss";
      }

      const { error } = await admin
        .from("picks").update({ result }).eq("id", pick.id);
      if (!error) updated++;
    }
  }
  return NextResponse.json({ updated });
}
