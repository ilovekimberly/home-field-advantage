import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate, isFinal, winnerAbbrev } from "@/lib/nhl";
import { sendEmail, competitionCancelledEmail } from "@/lib/email";

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
  const today = new Date().toISOString().slice(0, 10);

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
  const { data: activeComps } = await supabase
    .from("competitions")
    .select("id, end_date")
    .eq("status", "active")
    .lte("end_date", today);

  let completed = 0;
  for (const comp of activeComps ?? []) {
    const { data: remaining } = await supabase
      .from("picks").select("id")
      .eq("competition_id", comp.id)
      .eq("result", "pending")
      .limit(1);

    if (!remaining || remaining.length === 0) {
      await supabase.from("competitions").update({ status: "complete" }).eq("id", comp.id);
      completed++;
    }
  }

  // ── 3. Auto-cancel weekly/season comps with no opponent after 3 days ──
  // Day 3 means start_date + 2 days has passed (i.e. today > start_date + 2).
  function addDays(d: string, n: number) {
    const dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  const { data: expiredComps } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "pending")
    .is("opponent_id", null)
    .neq("duration", "daily")
    .lte("start_date", addDays(today, -2)); // started 3+ days ago

  let cancelled = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://home-field-advantage.vercel.app";

  for (const comp of expiredComps ?? []) {
    await supabase.from("competitions").update({ status: "cancelled" }).eq("id", comp.id);
    cancelled++;

    // Email the creator.
    const { data: creator } = await supabase
      .from("profiles").select("email, display_name").eq("id", comp.creator_id).single();

    if (creator?.email) {
      const { subject, html } = competitionCancelledEmail({
        toName: creator.display_name ?? creator.email,
        competitionName: comp.name,
        reason: "weekly",
        newCompUrl: `${siteUrl}/competitions/new`,
      });
      sendEmail({ to: creator.email, subject, html }).catch(console.error);
    }
  }

  console.log(`cron/score: ${updated} picks scored, ${completed} completed, ${cancelled} cancelled`);
  return NextResponse.json({ updated, completed, cancelled });
}
