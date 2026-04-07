import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate, isFinal, winnerAbbrev } from "@/lib/nhl";

// GET /api/cron/score
// Called automatically by Vercel Cron (configured in vercel.json).
// Also callable manually from the competition page with the right secret.
//
// Protected by CRON_SECRET — Vercel sends this automatically via the
// Authorization header. Manual callers must pass ?secret=CRON_SECRET.
//
// Runs through every pending pick across every active competition and
// resolves win/loss/push once the game is final.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Vercel cron sends the secret as a Bearer token.
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  const querySecret = searchParams.get("secret");
  const secret = process.env.CRON_SECRET;

  if (secret && bearerToken !== secret && querySecret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // If no CRON_SECRET is set, only allow in development.
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const supabase = createSupabaseServerClient();

  // Pull every pending pick across all competitions.
  const { data: pending, error } = await supabase
    .from("picks")
    .select("*")
    .eq("result", "pending");

  if (error) {
    console.error("cron/score: DB error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ updated: 0, message: "No pending picks to score." });
  }

  // Group by date so we hit the NHL API once per date.
  const byDate = new Map<string, typeof pending>();
  for (const p of pending) {
    const arr = byDate.get(p.game_date) ?? [];
    arr.push(p);
    byDate.set(p.game_date, arr);
  }

  let updated = 0;
  let failed = 0;
  const log: string[] = [];

  for (const [date, picks] of byDate) {
    let games;
    try {
      games = await fetchNHLScheduleForDate(date);
    } catch (e) {
      console.error(`cron/score: NHL API failed for ${date}`, e);
      failed += picks.length;
      continue;
    }

    for (const pick of picks) {
      const game = games.find((g) => g.id === pick.game_id);
      if (!game) {
        log.push(`pick ${pick.id}: game ${pick.game_id} not found on ${date}`);
        continue;
      }
      if (!isFinal(game.gameState)) {
        // Game not finished yet — leave as pending.
        continue;
      }

      const winner = winnerAbbrev(game);
      let result: string;
      if (winner === null) {
        result = "push"; // shouldn't happen in NHL (no ties) but just in case
      } else {
        result = winner === pick.picked_team_abbrev ? "win" : "loss";
      }

      const { error: updateErr } = await supabase
        .from("picks")
        .update({ result })
        .eq("id", pick.id);

      if (updateErr) {
        console.error(`cron/score: failed to update pick ${pick.id}`, updateErr);
        failed++;
      } else {
        updated++;
        log.push(`pick ${pick.id}: ${pick.picked_team_abbrev} → ${result}`);
      }
    }
  }

  console.log(`cron/score complete: ${updated} updated, ${failed} failed`);
  return NextResponse.json({ updated, failed, log });
}
