import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate, isFinal, winnerAbbrev } from "@/lib/nhl";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  const querySecret = searchParams.get("secret");
  const secret = process.env.CRON_SECRET;

  if (secret && bearerToken !== secret && querySecret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const supabase = createSupabaseServerClient();

  // ── 1. Score all pending picks ─────────────────────────────────────────
  const { data: pending, error } = await supabase
    .from("picks").select("*").eq("result", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  const affectedCompIds = new Set<string>();

  if (pending && pending.length > 0) {
    const byDate = new Map<string, typeof pending>();
    for (const p of pending) {
      const arr = byDate.get(p.game_date) ?? [];
      arr.push(p);
      byDate.set(p.game_date, arr);
    }

    for (const [date, picks] of byDate) {
      let games;
      try { games = await fetchNHLScheduleForDate(date); }
      catch { continue; }

      for (const pick of picks) {
        const game = games.find((g) => g.id === pick.game_id);
        if (!game || !isFinal(game.gameState)) continue;

        const winner = winnerAbbrev(game);
        const result = winner === null ? "push"
          : winner === pick.picked_team_abbrev ? "win" : "loss";

        const { error: updateErr } = await supabase
          .from("picks").update({ result }).eq("id", pick.id);
        if (!updateErr) {
          updated++;
          affectedCompIds.add(pick.competition_id);
        }
      }
    }
  }

  // ── 2. Mark competitions as complete ──────────────────────────────────
  // A competition is complete when its end_date has passed AND every pick
  // in it has a non-pending result (or it has no picks at all but the date
  // has passed, for daily comps with no games).
  const today = new Date().toISOString().slice(0, 10);

  const { data: activeComps } = await supabase
    .from("competitions")
    .select("id, end_date")
    .eq("status", "active")
    .lte("end_date", today); // end date is today or in the past

  let completed = 0;
  for (const comp of activeComps ?? []) {
    const { data: remaining } = await supabase
      .from("picks")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("result", "pending")
      .limit(1);

    // No pending picks left — mark as complete.
    if (!remaining || remaining.length === 0) {
      await supabase
        .from("competitions")
        .update({ status: "complete" })
        .eq("id", comp.id);
      completed++;
    }
  }

  console.log(`cron/score: ${updated} picks scored, ${completed} competitions completed`);
  return NextResponse.json({ updated, completed });
}
