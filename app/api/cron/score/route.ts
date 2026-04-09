import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame, winnerAbbrevGame } from "@/lib/schedule";
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
    // Fetch sport for each competition.
    const compIds = [...new Set(pending.map((p) => p.competition_id))];
    const { data: comps } = await supabase
      .from("competitions").select("id, sport").in("id", compIds);
    const sportMap = new Map((comps ?? []).map((c) => [c.id, c.sport ?? "NHL"]));

    // Group by date+sport so we fetch the schedule once per combination.
    const byDateSport = new Map<string, typeof pending>();
    for (const p of pending) {
      const sport = sportMap.get(p.competition_id) ?? "NHL";
      const key = `${p.game_date}__${sport}`;
      const arr = byDateSport.get(key) ?? [];
      arr.push(p);
      byDateSport.set(key, arr);
    }

    for (const [key, picks] of byDateSport) {
      const [date, sport] = key.split("__");
      let games;
      try { games = await fetchScheduleForDate(sport, date); }
      catch { continue; }

      for (const pick of picks) {
        const game = games.find((g) => String(g.id) === String(pick.game_id));
        if (!game || !isFinalGame(game)) continue;

        const winner = winnerAbbrevGame(game);
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
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayISO = yesterday.toISOString().slice(0, 10);

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

    // Close if no pending picks remain, OR if the end date was yesterday or
    // earlier — at that point games are definitely over regardless of scoring.
    const endDatePassed = comp.end_date <= yesterdayISO;

    if (!remaining || remaining.length === 0 || endDatePassed) {
      // Mark any still-pending picks as unscored so they don't block future closes.
      if (remaining && remaining.length > 0) {
        await supabase
          .from("picks")
          .update({ result: "unscored" })
          .eq("competition_id", comp.id)
          .eq("result", "pending");
      }
      await supabase.from("competitions").update({ status: "complete" }).eq("id", comp.id);
      completed++;
    }
  }

  // ── 3. Auto-cancel pending comps with no opponent ─────────────────────
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://home-field-advantage.vercel.app";

  function addDays(d: string, n: number) {
    const dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  // Daily comps: cancel if start_date is in the past and no opponent joined.
  const { data: expiredDailies } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "pending")
    .eq("duration", "daily")
    .is("opponent_id", null)
    .lt("start_date", today); // start date already passed

  for (const comp of expiredDailies ?? []) {
    await supabase.from("competitions").update({ status: "cancelled" }).eq("id", comp.id);

    const { data: creator } = await supabase
      .from("profiles").select("email, display_name").eq("id", comp.creator_id).single();

    if (creator?.email) {
      const { subject, html } = competitionCancelledEmail({
        toName: creator.display_name ?? creator.email,
        competitionName: comp.name,
        reason: "daily",
        newCompUrl: `${siteUrl}/competitions/new`,
      });
      sendEmail({ to: creator.email, subject, html }).catch(console.error);
    }
  }

  // Weekly/season comps: cancel after 3 days with no opponent.
  const { data: expiredComps } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "pending")
    .is("opponent_id", null)
    .neq("duration", "daily")
    .lte("start_date", addDays(today, -2)); // started 3+ days ago

  let cancelled = 0;

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
