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

  // Fetch current NFL week games
  let weekInfo;
  let games;
  try {
    const result = await fetchNFLScoreboard();
    weekInfo = result.weekInfo;
    games    = result.games;
  } catch (e) {
    console.error("score-survivor: NFL fetch failed", e);
    return NextResponse.json({ error: "NFL schedule fetch failed" }, { status: 503 });
  }

  // Build a map: teamAbbrev → did they win this week?
  const teamResults = new Map<string, "win" | "loss">();
  for (const g of games) {
    if (g.gameState !== "FINAL") continue;
    if (g.homeScore == null || g.awayScore == null) continue;
    if (g.homeScore === g.awayScore) continue; // shouldn't happen in NFL but be safe
    const homeWon = g.homeScore > g.awayScore;
    teamResults.set(g.homeTeam.abbrev, homeWon ? "win" : "loss");
    teamResults.set(g.awayTeam.abbrev, homeWon ? "loss" : "win");
  }

  // Find all active survivor competitions
  const { data: survivorComps } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("format", "survivor")
    .eq("status", "active");

  if (!survivorComps || survivorComps.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active survivor competitions" });
  }

  const results: Record<string, any> = {};

  for (const comp of survivorComps) {
    const competitionUrl = `${siteUrl}/competitions/${comp.id}`;

    // Get pending picks for this week
    const { data: pendingPicks } = await supabase
      .from("survivor_picks")
      .select("id, user_id, week_number, picked_team_abbrev, picked_team_name, result")
      .eq("competition_id", comp.id)
      .eq("week_number", weekInfo.week)
      .eq("result", "pending");

    if (!pendingPicks || pendingPicks.length === 0) {
      results[comp.id] = { skipped: true, reason: "No pending picks this week" };
      continue;
    }

    let scored = 0;
    let eliminated = 0;
    const eliminatedUserIds: string[] = [];

    for (const pick of pendingPicks) {
      const teamResult = teamResults.get(pick.picked_team_abbrev);
      if (!teamResult) continue; // game not final yet

      // Score the pick
      await supabase
        .from("survivor_picks")
        .update({ result: teamResult, updated_at: new Date().toISOString() })
        .eq("id", pick.id);

      scored++;

      if (teamResult === "loss") {
        // Eliminate this member
        await supabase
          .from("competition_members")
          .update({
            survivor_status:         "eliminated",
            survivor_eliminated_week: pick.week_number,
          })
          .eq("competition_id", comp.id)
          .eq("user_id", pick.user_id);

        eliminated++;
        eliminatedUserIds.push(pick.user_id as string);
      }
    }

    // Also auto-eliminate members with NO pick this week (missed deadline)
    const { data: allMembers } = await supabase
      .from("competition_members")
      .select("user_id, survivor_status")
      .eq("competition_id", comp.id)
      .eq("survivor_status", "alive");

    const { data: thisWeekPicks } = await supabase
      .from("survivor_picks")
      .select("user_id")
      .eq("competition_id", comp.id)
      .eq("week_number", weekInfo.week);

    const pickedUserIds = new Set((thisWeekPicks ?? []).map((p: any) => p.user_id as string));
    const noPick = (allMembers ?? []).filter(
      (m: any) => !pickedUserIds.has(m.user_id as string)
    );

    for (const m of noPick) {
      await supabase
        .from("competition_members")
        .update({
          survivor_status:          "eliminated",
          survivor_eliminated_week: weekInfo.week,
        })
        .eq("competition_id", comp.id)
        .eq("user_id", m.user_id);

      eliminated++;
      eliminatedUserIds.push(m.user_id as string);
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

        // Find the team name for this person's pick
        const theirPick = (pendingPicks ?? []).find(
          (pk: any) => pk.user_id === p.id
        );
        const teamName = theirPick?.picked_team_name ?? "your team";

        const { subject, html } = survivorEliminationEmail({
          toName:          p.display_name ?? p.email,
          competitionName: comp.name,
          competitionUrl,
          weekLabel:       weekInfo.label,
          teamName,
          survivorsLeft:   survivorsLeftCount,
        });

        await sendEmail({ to: p.email, subject, html });
      }
    }

    // ── Check for winner ───────────────────────────────────────────────────

    if (survivorsLeftCount <= 1) {
      // Mark competition complete
      await supabase
        .from("competitions")
        .update({ status: "complete" })
        .eq("id", comp.id);

      // Send winner email(s)
      if (survivorsLeftCount >= 1) {
        const winnerIds = (survivorsLeft ?? []).map((s: any) => s.user_id as string);
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
      weekNumber: weekInfo.week,
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
