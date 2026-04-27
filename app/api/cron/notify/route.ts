import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate } from "@/lib/schedule";
import { whoPicksFirst, type Player } from "@/lib/picks";
import { sendEmail, picksOpenEmail, competitionCancelledEmail } from "@/lib/email";

// GET /api/cron/notify
// Runs every 30 minutes (noon–10 PM UTC via cron-job.org).
//
// For each sport that has active competitions today:
//   1. Fetch that sport's schedule to find the first game time.
//   2. Check whether we're in the 2-hour notification window
//      (window is 29 min wide so the 30-min cron catches it exactly once).
//   3. Send "picks are open" emails to eligible competitions of that sport.
//
// Also auto-cancels daily competitions whose sport's first game has already
// started and still have no opponent.

type SportKey = "NHL" | "MLB";

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

  const now   = new Date();
  const nowMs = now.getTime();
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const supabase   = createSupabaseAdminClient();
  const siteUrl    = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

  // ── Find all active/pending competitions that have started ──────────────
  // No end_date filter — playoff runs extend past original season cutoffs.
  const { data: allComps } = await supabase
    .from("competitions")
    .select("*")
    .in("status", ["active"])
    .not("opponent_id", "is", null)
    .lte("start_date", today);

  const comps = allComps ?? [];

  // Group competition IDs by sport (null sport → NHL).
  const sportComps: Record<SportKey, typeof comps> = { NHL: [], MLB: [] };
  for (const comp of comps) {
    const sport = (comp.sport ?? "NHL") as SportKey;
    if (sport === "NHL" || sport === "MLB") sportComps[sport].push(comp);
  }

  const activeSports = (Object.keys(sportComps) as SportKey[]).filter(
    (s) => sportComps[s].length > 0
  );

  if (activeSports.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active competitions today" });
  }

  // Pre-load all picks and profiles for eligible competitions.
  const allCompIds = comps.map((c) => c.id);

  const { data: allPicks } = await supabase
    .from("picks")
    .select("competition_id, picker_id, result, game_date, pick_index")
    .in("competition_id", allCompIds);

  const profileIds = Array.from(new Set(
    comps.flatMap((c) => [c.creator_id, c.opponent_id].filter(Boolean))
  ));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .in("id", profileIds);
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Already-notified competition IDs for today.
  const { data: alreadySent } = await supabase
    .from("competition_notifications")
    .select("competition_id")
    .in("competition_id", allCompIds)
    .eq("notification_date", today)
    .eq("notification_type", "picks_open");
  const alreadySentIds = new Set((alreadySent ?? []).map((r) => r.competition_id));

  const results: Record<string, { sent: number; skipped: string | null }> = {};
  let totalSent = 0;

  for (const sport of activeSports) {
    // ── 1. Fetch this sport's schedule ──────────────────────────────────
    let games: Awaited<ReturnType<typeof fetchScheduleForDate>>;
    try {
      games = await fetchScheduleForDate(sport, today);
    } catch (e) {
      console.error(`cron/notify: ${sport} schedule failed`, e);
      results[sport] = { sent: 0, skipped: "schedule fetch failed" };
      continue;
    }

    if (!games || games.length === 0) {
      results[sport] = { sent: 0, skipped: "no games today" };
      continue;
    }

    // ── 2. Check the 2-hour notification window ─────────────────────────
    const sorted     = [...games].sort((a, b) =>
      new Date(a.startTimeUTC).getTime() - new Date(b.startTimeUTC).getTime()
    );
    const firstGame   = sorted[0];
    const firstGameMs = new Date(firstGame.startTimeUTC).getTime();

    // Window: [firstGame - 2h, firstGame - 2h + 29min]
    const windowOpen  = firstGameMs - 2 * 60 * 60 * 1000;
    const windowClose = windowOpen  + 29 * 60 * 1000;

    // ── 3. Auto-cancel daily comps with no opponent once first game starts ─
    if (nowMs >= firstGameMs) {
      const pendingDailies = sportComps[sport].filter(
        (c) => c.status === "pending" && c.duration === "daily" && !c.opponent_id
      );
      for (const comp of pendingDailies) {
        await supabase.from("competitions").update({ status: "cancelled" }).eq("id", comp.id);
        const creator = profileMap.get(comp.creator_id);
        if (creator?.email) {
          const { subject, html } = competitionCancelledEmail({
            toName:          creator.display_name ?? creator.email,
            competitionName: comp.name,
            reason:          "daily",
            newCompUrl:      `${siteUrl}/competitions/new`,
            sport:           comp.sport ?? "NHL",
          });
          sendEmail({ to: creator.email, subject, html }).catch(console.error);
        }
      }
      if (pendingDailies.length > 0) {
        console.log(`cron/notify: cancelled ${pendingDailies.length} pending daily ${sport} comp(s)`);
      }
    }

    if (nowMs < windowOpen) {
      const minsUntil = Math.round((windowOpen - nowMs) / 60000);
      results[sport] = { sent: 0, skipped: `window opens in ${minsUntil} min` };
      continue;
    }
    if (nowMs > windowClose) {
      results[sport] = { sent: 0, skipped: "window already passed" };
      continue;
    }

    // ── 4. Send emails ───────────────────────────────────────────────────
    const firstGameTimeET = new Date(firstGame.startTimeUTC).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
    }) + " ET";

    const eligible = sportComps[sport].filter(
      (c) => c.duration !== "daily" && !alreadySentIds.has(c.id)
    );

    let sportSent = 0;

    for (const comp of eligible) {
      const picks = (allPicks ?? []).filter((p) => p.competition_id === comp.id);

      const recordA = { wins: 0, losses: 0, pushes: 0 };
      const recordB = { wins: 0, losses: 0, pushes: 0 };
      for (const p of picks) {
        if (p.game_date >= today) continue;
        const rec = p.picker_id === comp.creator_id ? recordA : recordB;
        if (p.result === "win")  rec.wins++;
        else if (p.result === "loss")  rec.losses++;
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

      const firstPickerSlot    = whoPicksFirst(recordA, recordB, prevFirstPicker, "A");
      const firstPickerUserId  = firstPickerSlot === "A" ? comp.creator_id : comp.opponent_id;
      const secondPickerUserId = firstPickerSlot === "A" ? comp.opponent_id : comp.creator_id;
      const competitionUrl     = `${siteUrl}/competitions/${comp.id}`;

      for (const [pickerId, hasPriority] of [
        [firstPickerUserId,  true],
        [secondPickerUserId, false],
      ] as [string, boolean][]) {
        const profile         = profileMap.get(pickerId);
        const opponentProfile = profileMap.get(
          pickerId === comp.creator_id ? comp.opponent_id : comp.creator_id
        );
        if (!profile?.email) continue;

        const { subject, html } = picksOpenEmail({
          toName:          profile.display_name ?? profile.email,
          opponentName:    opponentProfile?.display_name ?? "Your opponent",
          competitionName: comp.name,
          competitionUrl,
          firstGameTime:   firstGameTimeET,
          gameCount:       games.length,
          hasPriority,
          sport:           comp.sport ?? "NHL",
        });

        const ok = await sendEmail({ to: profile.email, subject, html });
        if (ok) sportSent++;
      }

      // Record notification sent.
      await supabase.from("competition_notifications").upsert({
        competition_id:    comp.id,
        notification_date: today,
        notification_type: "picks_open",
      }, { onConflict: "competition_id,notification_date,notification_type" });
    }

    console.log(`cron/notify [${sport}]: sent ${sportSent} emails to ${eligible.length} competitions`);
    results[sport] = { sent: sportSent, skipped: null };
    totalSent += sportSent;
  }

  return NextResponse.json({ totalSent, results });
}
