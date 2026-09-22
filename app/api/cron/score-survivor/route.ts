import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNFLScoreboard } from "@/lib/nfl";
import { sendEmail, survivorEliminationEmail, survivorWinnerEmail } from "@/lib/email";

// GET /api/cron/score-survivor
//
// Scores pending NFL survivor picks. Safe to run multiple times.
// Runs Tuesday morning (after Monday Night Football ends).
//
// Logic:
//   1. Find all survivor competitions with pending picks
//   2. Fetch current NFL week results
//   3. Score each pick: win if team won, loss if team lost
//   4. For losses: mark member as eliminated
//   5. Send elimination emails
//   6. Check if competition is over (0 or 1 survivor remains) → send winner email

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const authHeader  = req.headers.get("authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  const querySecret = searchParams.get("secret");
  const secret      = process.env.CRON_SECRET;

  if (secret && bearerToken !== secret && querySecret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const supabase = createSupabaseAdminClient();
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

  // Resolve the current NFL week.
  let currentWeek: number;
  let seasonYear: number;
  try {
    const probe = await fetchNFLScoreboard();
    currentWeek = probe.weekInfo.week;
    seasonYear  = probe.weekInfo.season;
  } catch (e) {
    console.error("score-survivor: NFL fetch failed", e);
    return NextResponse.json({ error: "NFL schedule fetch failed" }, { status: 503 });
  }

  // Load every regular-season week up to now, not just the current one.
  //
  // This route previously scored only ESPN's *current* week, which left two
  // holes: picks from a week that had already rolled over were never scored,
  // and team results were looked up against the wrong week's games. Loading
  // each week separately keeps every pick matched to its own game.
  const weekNumbers = Array.from({ length: currentWeek }, (_, i) => i + 1);
  const weekData = new Map<number, {
    results: Map<string, "win" | "loss" | "tie">;
    complete: boolean;
    lastDate: string | null;
  }>();

  await Promise.all(weekNumbers.map(async (wk) => {
    try {
      const { games } = await fetchNFLScoreboard({
        week: wk, season: seasonYear, seasonType: 2,
      });
      const results = new Map<string, "win" | "loss" | "tie">();
      let complete = games.length > 0;
      let lastDate: string | null = null;

      for (const g of games) {
        if (g.startTimeUTC > (lastDate ?? "")) lastDate = g.startTimeUTC;
        const final = g.gameState === "FINAL" || g.gameState === "OFF";
        if (!final) { complete = false; continue; }
        if (g.homeScore == null || g.awayScore == null) { complete = false; continue; }
        if (g.homeScore === g.awayScore) {
          results.set(g.homeTeam.abbrev, "tie");
          results.set(g.awayTeam.abbrev, "tie");
          continue;
        }
        const homeWon = g.homeScore > g.awayScore;
        results.set(g.homeTeam.abbrev, homeWon ? "win" : "loss");
        results.set(g.awayTeam.abbrev, homeWon ? "loss" : "win");
      }
      weekData.set(wk, { results, complete, lastDate });
    } catch {
      // Leave the week absent — picks in it simply stay pending this run.
    }
  }));

  // Find all active survivor competitions
  const { data: survivorComps } = await supabase
    .from("competitions")
    .select("id, name, start_date, wipeout_rule")
    .eq("format", "survivor")
    .eq("status", "active");

  if (!survivorComps || survivorComps.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active survivor competitions" });
  }

  const results: Record<string, any> = {};

  for (const comp of survivorComps) {
    const competitionUrl = `${siteUrl}/competitions/${comp.id}`;

    // Every pick in this competition, all weeks — needed both for scoring and
    // to tell who missed a deadline.
    const { data: allPicks } = await supabase
      .from("survivor_picks")
      .select("id, user_id, week_number, team_abbrev, team_name, result")
      .eq("competition_id", comp.id);

    const pendingPicks = (allPicks ?? []).filter((p: any) => p.result === "pending");

    let scored = 0;
    let eliminated = 0;
    const eliminatedUserIds: string[] = [];

    // ── Score pending picks against their OWN week ──────────────────────
    for (const pick of pendingPicks) {
      const wk = weekData.get(pick.week_number as number);
      if (!wk) continue;
      const teamResult = wk.results.get(pick.team_abbrev as string);
      if (!teamResult) continue; // game not final yet

      // A tie is not a loss. Mark it unscored so it doesn't hang as pending
      // forever, and let the member survive the week.
      const stored = teamResult === "tie" ? "unscored" : teamResult;

      await supabase
        .from("survivor_picks")
        .update({ result: stored, updated_at: new Date().toISOString() })
        .eq("id", pick.id);

      scored++;

      if (teamResult === "loss") {
        await supabase
          .from("competition_members")
          .update({
            survivor_status:          "eliminated",
            survivor_eliminated_week: pick.week_number,
          })
          .eq("competition_id", comp.id)
          .eq("user_id", pick.user_id);

        eliminated++;
        eliminatedUserIds.push(pick.user_id as string);
      }
    }

    // ── Eliminate anyone who missed a completed week ────────────────────
    //
    // This used to sit behind an early `continue` that fired whenever there
    // were no pending picks — so in a pool where someone simply never picked,
    // they were never eliminated and the competition stayed open forever.
    // It now runs on its own, for every completed week since the pool started.
    const { data: aliveMembers } = await supabase
      .from("competition_members")
      .select("user_id")
      .eq("competition_id", comp.id)
      .eq("survivor_status", "alive");

    for (const wk of weekNumbers) {
      const info = weekData.get(wk);
      if (!info || !info.complete) continue;
      // Skip weeks that finished before this competition began.
      if (info.lastDate && info.lastDate.slice(0, 10) < comp.start_date) continue;

      const pickedThatWeek = new Set(
        (allPicks ?? [])
          .filter((p: any) => p.week_number === wk)
          .map((p: any) => p.user_id as string)
      );

      for (const m of aliveMembers ?? []) {
        const uid = m.user_id as string;
        if (pickedThatWeek.has(uid)) continue;
        if (eliminatedUserIds.includes(uid)) continue;

        await supabase
          .from("competition_members")
          .update({
            survivor_status:          "eliminated",
            survivor_eliminated_week: wk,
          })
          .eq("competition_id", comp.id)
          .eq("user_id", uid);

        eliminated++;
        eliminatedUserIds.push(uid);
      }
    }

    // ── Send elimination emails ────────────────────────────────────────────

    // Count survivors remaining after this round
    const { data: survivorsLeft } = await supabase
      .from("competition_members")
      .select("user_id")
      .eq("competition_id", comp.id)
      .eq("survivor_status", "alive");

    const survivorsLeftCount = (survivorsLeft ?? []).length;

    if (eliminatedUserIds.length > 0) {
      const { data: eliminatedProfiles } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", eliminatedUserIds);

      for (const p of eliminatedProfiles ?? []) {
        if (!p.email) continue;

        // Team they went out on. Someone eliminated for missing a deadline has
        // no pick, so the email says so rather than naming a team.
        const theirPick = (allPicks ?? [])
          .filter((pk: any) => pk.user_id === p.id && pk.result === "loss")
          .sort((a: any, b: any) => b.week_number - a.week_number)[0];
        const teamName = theirPick?.team_name ?? "no pick";

        const { subject, html } = survivorEliminationEmail({
          toName:          p.display_name ?? p.email,
          competitionName: comp.name,
          competitionUrl,
          weekLabel:       `Week ${currentWeek}`,
          teamName,
          survivorsLeft:   survivorsLeftCount,
        });

        await sendEmail({ to: p.email, subject, html });
      }
    }

    // ── Wipeout: everyone knocked out in the same week ─────────────────────
    //
    // Without a rule this just ended with nobody winning. The creator picks
    // the behaviour when setting the pool up (competitions.wipeout_rule).
    let wipeoutWinnerIds: string[] = [];
    if (survivorsLeftCount === 0 && eliminatedUserIds.length > 0) {
      const rule = (comp as any).wipeout_rule ?? "co_winners";

      // The week that wiped everyone out.
      const { data: lastOut } = await supabase
        .from("competition_members")
        .select("user_id, survivor_eliminated_week")
        .eq("competition_id", comp.id)
        .order("survivor_eliminated_week", { ascending: false })
        .limit(1);
      const finalWeek = lastOut?.[0]?.survivor_eliminated_week as number | undefined;

      if (rule === "revive" && finalWeek != null) {
        // Undo that week's eliminations and let the pool continue.
        await supabase
          .from("competition_members")
          .update({ survivor_status: "alive", survivor_eliminated_week: null })
          .eq("competition_id", comp.id)
          .eq("survivor_eliminated_week", finalWeek);

        console.log(`score-survivor [${comp.id}]: wipeout in week ${finalWeek} — revived all`);
        results[comp.id] = {
          weekNumber: currentWeek, scored, eliminated,
          survivorsLeft: 0, wipeout: "revived",
        };
        continue; // pool stays active
      }

      if (rule === "co_winners" && finalWeek != null) {
        const { data: coWinners } = await supabase
          .from("competition_members")
          .select("user_id")
          .eq("competition_id", comp.id)
          .eq("survivor_eliminated_week", finalWeek);

        // Not picking is a loss, so a no-show can't share the win. Only
        // members who actually made a pick that week are eligible — someone
        // who picked and lost outlasts someone who never showed up.
        const pickedFinalWeek = new Set(
          (allPicks ?? [])
            .filter((p: any) => p.week_number === finalWeek)
            .map((p: any) => p.user_id as string)
        );

        wipeoutWinnerIds = (coWinners ?? [])
          .map((m: any) => m.user_id as string)
          .filter((uid) => pickedFinalWeek.has(uid));

        // If nobody picked, nobody wins.
        if (wipeoutWinnerIds.length === 0) {
          console.log(`score-survivor [${comp.id}]: wipeout week ${finalWeek} — no eligible winners (no picks)`);
        }
      }
      // rule === "no_winner" falls through with an empty winner list.
    }

    // ── Check for winner ───────────────────────────────────────────────────

    if (survivorsLeftCount <= 1) {
      // Mark competition complete
      await supabase
        .from("competitions")
        .update({ status: "complete" })
        .eq("id", comp.id);

      // Send winner email(s). Normally the last survivor(s); on a wipeout it's
      // whoever the wipeout rule crowned.
      const winnerIds = survivorsLeftCount >= 1
        ? (survivorsLeft ?? []).map((s: any) => s.user_id as string)
        : wipeoutWinnerIds;

      if (winnerIds.length > 0) {
        const { data: winnerProfiles } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", winnerIds);

        const isSplit = winnerIds.length > 1;
        const coWinnerNames = (winnerProfiles ?? [])
          .filter((p: any) => !!p.display_name)
          .map((p: any) => p.display_name as string);

        for (const p of winnerProfiles ?? []) {
          if (!p.email) continue;
          const { subject, html } = survivorWinnerEmail({
            toName:          p.display_name ?? p.email,
            competitionName: comp.name,
            competitionUrl,
            isSplit,
            coWinners:       isSplit
              ? coWinnerNames.filter((n) => n !== p.display_name)
              : undefined,
          });
          await sendEmail({ to: p.email, subject, html });
        }
      }
    }

    results[comp.id] = {
      weekNumber: currentWeek,
      scored,
      eliminated,
      survivorsLeft: survivorsLeftCount,
    };
    console.log(
      `score-survivor [${comp.id}]: scored ${scored}, eliminated ${eliminated}, ${survivorsLeftCount} remaining`
    );
  }

  return NextResponse.json({ results });
}
