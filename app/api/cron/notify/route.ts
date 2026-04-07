import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate } from "@/lib/nhl";
import { whoPicksFirst, type Player } from "@/lib/picks";
import { sendEmail, picksOpenEmail, competitionCancelledEmail } from "@/lib/email";

// GET /api/cron/notify
// Runs every 30 minutes (see vercel.json).
//
// Logic:
//  1. Fetch today's NHL schedule.
//  2. If no games, do nothing.
//  3. Find the first game's start time. Compute the notification window:
//     2 hours before the first game, with a 29-minute trailing edge so the
//     30-min cron cadence catches it cleanly.
//  4. If we're not in the window yet, do nothing.
//  5. For every active weekly/season competition that:
//       - Has both players joined
//       - Has NOT already sent a 'picks_open' notification today
//     — determine who picks first, send them (and optionally both players)
//       the "picks are open" email, and record the notification sent.

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

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // ── 1. Fetch tonight's NHL schedule ───────────────────────────────────
  let games;
  try { games = await fetchNHLScheduleForDate(today); }
  catch (e) {
    console.error("cron/notify: NHL API failed", e);
    return NextResponse.json({ error: "NHL API failed" }, { status: 502 });
  }

  if (!games || games.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No games today" });
  }

  // ── 2. Check the 2-hour notification window ────────────────────────────
  // Sort games by start time, find the earliest.
  const sorted = [...games].sort(
    (a, b) => new Date(a.startTimeUTC).getTime() - new Date(b.startTimeUTC).getTime()
  );
  const firstGame = sorted[0];
  const firstGameMs = new Date(firstGame.startTimeUTC).getTime();

  // Window: [firstGame - 2h, firstGame - 2h + 29min]
  // The 29-minute trailing edge means a cron running every 30 min will
  // always catch the window without sending twice.
  const windowOpen  = firstGameMs - 2 * 60 * 60 * 1000;
  const windowClose = windowOpen  + 29 * 60 * 1000;
  const nowMs = now.getTime();

  if (nowMs < windowOpen) {
    const minsUntil = Math.round((windowOpen - nowMs) / 60000);
    return NextResponse.json({ skipped: true, reason: `Window opens in ${minsUntil} min` });
  }
  if (nowMs > windowClose) {
    return NextResponse.json({ skipped: true, reason: "Window already passed" });
  }

  // Format first game time in ET for the email.
  const firstGameTimeET = new Date(firstGame.startTimeUTC).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }) + " ET";

  const supabase = createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://home-field-advantage.vercel.app";

  // ── 3. Auto-cancel daily comps with no opponent once first game starts ─
  if (nowMs >= firstGameMs) {
    const { data: pendingDailies } = await supabase
      .from("competitions")
      .select("*")
      .eq("status", "pending")
      .eq("duration", "daily")
      .is("opponent_id", null)
      .eq("start_date", today);

    for (const comp of pendingDailies ?? []) {
      await supabase
        .from("competitions")
        .update({ status: "cancelled" })
        .eq("id", comp.id);

      const { data: creator } = await supabase
        .from("profiles")
        .select("email, display_name")
        .eq("id", comp.creator_id)
        .single();

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

    if ((pendingDailies ?? []).length > 0) {
      console.log(`cron/notify: cancelled ${pendingDailies!.length} daily comp(s) with no opponent`);
    }
  }

  // ── 4. Find eligible competitions ─────────────────────────────────────

  const { data: comps } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "active")
    .neq("duration", "daily") // daily comps don't need this nudge
    .not("opponent_id", "is", null)
    .lte("start_date", today)
    .gte("end_date", today);

  if (!comps || comps.length === 0) {
    return NextResponse.json({ sent: 0, reason: "No eligible competitions" });
  }

  // Filter out competitions that already got a notification today.
  const compIds = comps.map((c) => c.id);
  const { data: alreadySent } = await supabase
    .from("competition_notifications")
    .select("competition_id")
    .in("competition_id", compIds)
    .eq("notification_date", today)
    .eq("notification_type", "picks_open");

  const alreadySentIds = new Set((alreadySent ?? []).map((r) => r.competition_id));
  const eligible = comps.filter((c) => !alreadySentIds.has(c.id));

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, reason: "All competitions already notified today" });
  }

  // ── 4. For each eligible competition, figure out who picks first ────────
  const allCompIds = eligible.map((c) => c.id);
  const { data: allPicks } = await supabase
    .from("picks")
    .select("competition_id, picker_id, result, game_date, pick_index")
    .in("competition_id", allCompIds);

  // Collect all participant profile IDs.
  const profileIds = Array.from(new Set(
    eligible.flatMap((c) => [c.creator_id, c.opponent_id].filter(Boolean))
  ));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .in("id", profileIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  let sent = 0;

  for (const comp of eligible) {
    const picks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);

    // Compute who picks first tonight.
    const recordA = { wins: 0, losses: 0, pushes: 0 };
    const recordB = { wins: 0, losses: 0, pushes: 0 };
    for (const p of picks) {
      if (p.game_date >= today) continue;
      const rec = p.picker_id === comp.creator_id ? recordA : recordB;
      if (p.result === "win") rec.wins++;
      else if (p.result === "loss") rec.losses++;
      else if (p.result === "push") rec.pushes++;
    }
    const prevDates = Array.from(new Set(
      picks.filter((p) => p.game_date < today).map((p) => p.game_date)
    )).sort();
    const prevDate = prevDates[prevDates.length - 1];
    let prevFirstPicker: Player | null = null;
    if (prevDate) {
      const fp = picks
        .filter((p) => p.game_date === prevDate)
        .sort((a: any, b: any) => a.pick_index - b.pick_index)[0];
      if (fp) prevFirstPicker = fp.picker_id === comp.creator_id ? "A" : "B";
    }
    const firstPickerSlot = whoPicksFirst(recordA, recordB, prevFirstPicker, "A");
    const firstPickerUserId = firstPickerSlot === "A" ? comp.creator_id : comp.opponent_id;
    const secondPickerUserId = firstPickerSlot === "A" ? comp.opponent_id : comp.creator_id;

    const competitionUrl = `${siteUrl}/competitions/${comp.id}`;

    // Send to both players — first picker gets the priority notice,
    // second picker gets a "heads up, picks open soon" version.
    for (const [pickerId, hasPriority] of [
      [firstPickerUserId, true],
      [secondPickerUserId, false],
    ] as [string, boolean][]) {
      const profile = profileMap.get(pickerId);
      const opponentProfile = profileMap.get(pickerId === comp.creator_id ? comp.opponent_id : comp.creator_id);
      if (!profile?.email) continue;

      const { subject, html } = picksOpenEmail({
        toName: profile.display_name ?? profile.email,
        opponentName: opponentProfile?.display_name ?? "Your opponent",
        competitionName: comp.name,
        competitionUrl,
        firstGameTime: firstGameTimeET,
        gameCount: games.length,
        hasPriority,
      });

      const ok = await sendEmail({ to: profile.email, subject, html });
      if (ok) sent++;
    }

    // Record that we notified this competition today.
    await supabase.from("competition_notifications").insert({
      competition_id: comp.id,
      notification_date: today,
      notification_type: "picks_open",
    }).onConflict ? undefined : undefined; // ignore if already exists
    // Use upsert to be safe:
    await supabase.from("competition_notifications").upsert({
      competition_id: comp.id,
      notification_date: today,
      notification_type: "picks_open",
    }, { onConflict: "competition_id,notification_date,notification_type" });
  }

  console.log(`cron/notify: sent ${sent} emails across ${eligible.length} competitions`);
  return NextResponse.json({ sent, competitions: eligible.length });
}
