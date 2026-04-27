import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame, winnerAbbrevGame } from "@/lib/schedule";
import { fifaOutcome } from "@/lib/fifa";
import { sendEmail, competitionCancelledEmail, perfectNightEmail, poolPicksOpenEmail } from "@/lib/email";

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

  const supabase = createSupabaseAdminClient();
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
      try { games = await fetchScheduleForDate(sport, date, true); }
      catch (e) {
        console.error(`cron/score: failed to fetch schedule for ${key}`, e);
        continue;
      }

      console.log(`cron/score: ${key} — fetched ${games.length} games, IDs: ${games.map(g => g.id).join(", ")}`);
      console.log(`cron/score: ${key} — pick game_ids: ${picks.map(p => p.game_id).join(", ")}`);

      for (const pick of picks) {
        const game = games.find((g) => String(g.id) === String(pick.game_id));
        if (!game) {
          console.log(`cron/score: [${pick.competition_id}] game ${pick.game_id} not found in ${key}`);
          continue;
        }
        if (!isFinalGame(game)) {
          // Postponed games will never finish — mark the pick as unscored so
          // they don't block the next day from opening for the user.
          if (game.gameState === "POSTPONED") {
            console.log(`cron/score: [${pick.competition_id}] game ${pick.game_id} postponed — marking unscored`);
            const { error: updateErr } = await supabase
              .from("picks").update({ result: "unscored" }).eq("id", pick.id);
            if (!updateErr) {
              updated++;
              affectedCompIds.add(pick.competition_id);
            }
          } else {
            console.log(`cron/score: [${pick.competition_id}] game ${pick.game_id} not final, state: ${game.gameState}`);
          }
          continue;
        }
        console.log(`cron/score: [${pick.competition_id}] scoring game ${pick.game_id}, state: ${game.gameState}`);

        let result: string;
        if (pick.pick_type === "over_under") {
          const finalTotal = (game.homeScore ?? 0) + (game.awayScore ?? 0);
          const line = pick.total_line;
          if (line == null) result = "unscored";
          else if (finalTotal === line) result = "loss";
          else if (finalTotal > line) result = pick.over_under_choice === "over" ? "win" : "loss";
          else result = pick.over_under_choice === "under" ? "win" : "loss";
        } else if (pick.pick_type === "spread") {
          const spreadLine = pick.spread_line;
          if (spreadLine == null) {
            result = "unscored";
          } else {
            const coverMargin = ((game.homeScore ?? 0) - (game.awayScore ?? 0)) + spreadLine;
            if (coverMargin === 0) result = "loss"; // push = loss
            else if (pick.spread_choice === "home") result = coverMargin > 0 ? "win" : "loss";
            else result = coverMargin < 0 ? "win" : "loss";
          }
        } else if (sport === "FIFA") {
          // FIFA picks use "HOME" / "AWAY" / "DRAW" as picked_team_abbrev.
          const outcome = fifaOutcome(game);
          if (outcome === null) result = "pending";
          else result = outcome === pick.picked_team_abbrev ? "win" : "loss";
        } else {
          const winner = winnerAbbrevGame(game);
          result = winner === null ? "push"
            : winner === pick.picked_team_abbrev ? "win" : "loss";
        }

        const { error: updateErr } = await supabase
          .from("picks").update({ result }).eq("id", pick.id);
        if (!updateErr) {
          updated++;
          affectedCompIds.add(pick.competition_id);
        }
      }
    }
  }

  // ── 2. Check for perfect nights and notify ────────────────────────────
  if (affectedCompIds.size > 0) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

    for (const compId of affectedCompIds) {
      // Fetch ALL picks for this competition (not just win/loss) so we can
      // verify a night is fully scored before calling it a perfect night.
      const { data: compPicks } = await supabase
        .from("picks")
        .select("picker_id, game_date, result")
        .eq("competition_id", compId);

      if (!compPicks || compPicks.length === 0) continue;

      const { data: comp } = await supabase
        .from("competitions")
        .select("id, name, sport, format, creator_id, opponent_id")
        .eq("id", compId)
        .single();
      if (!comp) continue;

      // Skip perfect night emails for pool competitions.
      if (comp.format === "pool") continue;

      // Only look at dates that have at least one newly-scored pick.
      const affectedDates = Array.from(new Set(
        compPicks
          .filter((p) => p.result === "win" || p.result === "loss")
          .map((p) => p.game_date)
      ));
      const players = [
        { id: comp.creator_id, slot: "A" },
        { id: comp.opponent_id, slot: "B" },
      ].filter((p) => p.id);

      for (const date of affectedDates) {
        const datePicks = compPicks.filter((p) => p.game_date === date);

        for (const player of players) {
          const myPicks = datePicks.filter((p) => p.picker_id === player.id);
          // Require at least 2 picks and all must be fully resolved.
          if (myPicks.length < 2) continue;
          const anyPending = myPicks.some(
            (p) => p.result !== "win" && p.result !== "loss" && p.result !== "push"
          );
          if (anyPending) continue; // Night not fully scored — wait for next run.
          const isPerfect = myPicks.every((p) => p.result === "win");
          if (!isPerfect) continue;

          // Check we haven't already sent a perfect night email for this date+player.
          // NOTE: select "competition_id" not "id" — the table has no id column.
          const notifKey = `perfect_night_${player.id}_${date}`;
          const { data: alreadySent } = await supabase
            .from("competition_notifications")
            .select("competition_id")
            .eq("competition_id", compId)
            .eq("notification_date", date)
            .eq("notification_type", notifKey)
            .maybeSingle();
          if (alreadySent) continue;

          // Fetch profiles for both players.
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, email, display_name")
            .in("id", players.map((p) => p.id));

          const sweeperProfile = profiles?.find((p) => p.id === player.id);
          const opponentProfile = profiles?.find((p) => p.id !== player.id);
          const sweeperName = sweeperProfile?.display_name ?? sweeperProfile?.email ?? "A player";
          const compUrl = `${siteUrl}/competitions/${compId}`;

          // Email both players.
          for (const profile of profiles ?? []) {
            if (!profile.email) continue;
            const isSweeper = profile.id === player.id;
            const { subject, html } = perfectNightEmail({
              toName: profile.display_name ?? profile.email,
              sweeper: sweeperName,
              isSweeper,
              wins: myPicks.length,
              competitionName: comp.name,
              competitionUrl: compUrl,
              date,
              sport: comp.sport ?? "NHL",
            });
            sendEmail({ to: profile.email, subject, html }).catch(console.error);
          }

          // Record so we don't send again.
          await supabase.from("competition_notifications").upsert({
            competition_id: compId,
            notification_date: date,
            notification_type: notifKey,
          }, { onConflict: "competition_id,notification_date,notification_type" });
        }
      }
    }
  }

  // ── 4. Pool picks-open reminder emails ────────────────────────────────
  // On the start date of every active pool competition, email all members
  // once to let them know picks are open. Uses competition_notifications to dedup.
  {
    const { data: poolsStartingToday } = await supabase
      .from("competitions")
      .select("id, name, sport, start_date, invite_token")
      .eq("format", "pool")
      .eq("status", "active")
      .eq("start_date", today);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

    for (const comp of poolsStartingToday ?? []) {
      const notifType = "pool_picks_open";

      // Check if we already sent this notification today.
      const { data: alreadySent } = await supabase
        .from("competition_notifications")
        .select("competition_id")
        .eq("competition_id", comp.id)
        .eq("notification_date", today)
        .eq("notification_type", notifType)
        .maybeSingle();
      if (alreadySent) continue;

      // Load all member emails.
      const { data: members } = await supabase
        .from("competition_members")
        .select("user_id")
        .eq("competition_id", comp.id);

      const memberIds = (members ?? []).map((m: any) => m.user_id);
      if (memberIds.length === 0) continue;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", memberIds);

      const compUrl = `${siteUrl}/competitions/${comp.id}`;

      for (const profile of profiles ?? []) {
        if (!profile.email) continue;
        const { subject, html } = poolPicksOpenEmail({
          toName: profile.display_name ?? profile.email,
          competitionName: comp.name,
          competitionUrl: compUrl,
          sport: comp.sport ?? "NHL",
          startDate: comp.start_date,
        });
        sendEmail({ to: profile.email, subject, html }).catch(console.error);
      }

      // Record so we don't send again.
      await supabase.from("competition_notifications").upsert({
        competition_id: comp.id,
        notification_date: today,
        notification_type: notifType,
      }, { onConflict: "competition_id,notification_date,notification_type" });
    }
  }

  // ── 6. Mark competitions as complete ──────────────────────────────────
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayISO = yesterday.toISOString().slice(0, 10);

  // Only apply the "force close" fallback on the final cron run of the night
  // (8 AM UTC = 4 AM ET), not the earlier 6:30 AM UTC run. This ensures late
  // west coast games have been scored before we force-close anything.
  const utcHour = new Date().getUTCHours();
  const isFinalRun = utcHour >= 8;

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

    const hasPendingPicks = remaining && remaining.length > 0;

    // Always close if no pending picks remain.
    // Only force-close (marking picks unscored) on the final run of the night.
    const endDatePassed = comp.end_date <= yesterdayISO;
    const shouldClose = !hasPendingPicks || (isFinalRun && endDatePassed);

    if (shouldClose) {
      if (hasPendingPicks) {
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

  // ── 7. Auto-cancel pending comps with no opponent ─────────────────────
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

  function addDays(d: string, n: number) {
    const dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  // Daily comps: cancel if start_date is in the past and no opponent joined.
  // Pool comps are excluded — they don't need an opponent and should never auto-cancel.
  const { data: expiredDailies } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "pending")
    .eq("duration", "daily")
    .is("opponent_id", null)
    .or("format.eq.1v1,format.is.null")
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
        sport: comp.sport ?? "NHL",
      });
      sendEmail({ to: creator.email, subject, html }).catch(console.error);
    }
  }

  // Weekly/season comps: cancel after 3 days with no opponent.
  // Pool comps are excluded — they don't need an opponent and should never auto-cancel.
  const { data: expiredComps } = await supabase
    .from("competitions")
    .select("*")
    .eq("status", "pending")
    .is("opponent_id", null)
    .or("format.eq.1v1,format.is.null")
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
        sport: comp.sport ?? "NHL",
      });
      sendEmail({ to: creator.email, subject, html }).catch(console.error);
    }
  }

  console.log(`cron/score: ${updated} picks scored, ${completed} completed, ${cancelled} cancelled`);
  return NextResponse.json({ updated, completed, cancelled });
}
