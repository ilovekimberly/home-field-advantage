import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNFLScoreboard, getNFLWeekLockTime } from "@/lib/nfl";
import { sendEmail, survivorKickoffRevealEmail } from "@/lib/email";

// GET /api/cron/notify-survivor
//
// Sends the Thursday kickoff "picks reveal" email to all alive survivors.
//
// Timing: runs every 30 min (or hourly) — checks if:
//   (a) The lock time has passed for the current NFL week
//   (b) The kickoff email hasn't been sent for this week yet
//   (c) At least one game is starting this week
//
// Uses competition_notifications to dedup (notification_type = "survivor_kickoff_reveal").

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

  const supabase  = createSupabaseAdminClient();
  const siteUrl   = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";
  const today     = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Fetch current NFL week
  let weekInfo;
  let games;
  try {
    const result = await fetchNFLScoreboard();
    weekInfo = result.weekInfo;
    games    = result.games;
  } catch (e) {
    console.error("notify-survivor: NFL fetch failed", e);
    return NextResponse.json({ error: "NFL schedule fetch failed" }, { status: 503 });
  }

  if (!games.length) {
    return NextResponse.json({ skipped: true, reason: "No NFL games this week" });
  }

  const lockTime = getNFLWeekLockTime(games);

  // ── Auto-submit planned picks ─────────────────────────────────────────
  // Runs in the hour before lock (and on any run after it, in case the cron
  // missed that window). Turns a plan entry flagged auto_submit into a real
  // pick for anyone who's alive and hasn't picked this week.
  let autoSubmitted = 0;
  if (lockTime && Date.now() >= new Date(lockTime).getTime() - 60 * 60 * 1000) {
    autoSubmitted = await autoSubmitPlannedPicks(supabase, weekInfo, games);
  }

  // Check if lock time has passed
  if (!lockTime || new Date() < new Date(lockTime)) {
    return NextResponse.json({
      skipped: true,
      reason: "Picks not locked yet",
      autoSubmitted,
    });
  }

  // Find active survivor competitions
  const { data: survivorComps } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("format", "survivor")
    .eq("status", "active");

  if (!survivorComps || survivorComps.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active survivor competitions" });
  }

  const notificationKey = `survivor_kickoff_reveal_week_${weekInfo.week}`;
  const results: Record<string, any> = {};
  let totalSent = 0;

  for (const comp of survivorComps) {
    const competitionUrl = `${siteUrl}/competitions/${comp.id}`;

    // Check if already sent for this week
    const { data: alreadySent } = await supabase
      .from("competition_notifications")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("notification_date", today)
      .eq("notification_type", notificationKey)
      .maybeSingle();

    if (alreadySent) {
      results[comp.id] = { skipped: true, reason: "Already sent this week" };
      continue;
    }

    // Get all members (alive + eliminated) for the picks reveal
    const { data: memberRows } = await supabase
      .from("competition_members")
      .select("user_id, survivor_status")
      .eq("competition_id", comp.id);

    if (!memberRows || memberRows.length === 0) {
      results[comp.id] = { skipped: true, reason: "No members" };
      continue;
    }

    const memberIds = memberRows.map((r: any) => r.user_id as string);

    // Load profiles
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", memberIds);

    const profileMap = new Map(
      (profiles ?? []).map((p: any) => [p.id as string, p])
    );

    // Load this week's picks for the reveal
    const { data: weekPicks } = await supabase
      .from("survivor_picks")
      .select("user_id, team_abbrev, team_name, result")
      .eq("competition_id", comp.id)
      .eq("week_number", weekInfo.week);

    const pickMap = new Map(
      (weekPicks ?? []).map((p: any) => [p.user_id as string, p])
    );

    // Build the picks reveal list
    const pickReveal = memberRows.map((row: any) => {
      const userId = row.user_id as string;
      const pick   = pickMap.get(userId);
      return {
        userId,
        name:       (profileMap.get(userId)?.display_name as string) ?? "Member",
        teamAbbrev: pick?.team_abbrev as string ?? "–",
        teamName:   pick?.team_name as string  ?? "No pick",
        status:     (row.survivor_status as "alive" | "eliminated") ?? "alive",
      };
    });

    // Send to all alive members
    const aliveRows = memberRows.filter(
      (r: any) => r.survivor_status === "alive"
    );
    let sent = 0;

    for (const row of aliveRows) {
      const profile = profileMap.get(row.user_id as string);
      if (!profile?.email) continue;

      const { subject, html } = survivorKickoffRevealEmail({
        toName:          (profile.display_name as string) ?? profile.email,
        competitionName: comp.name,
        competitionUrl,
        weekLabel:       weekInfo.label,
        picks:           pickReveal,
      });

      const ok = await sendEmail({ to: profile.email as string, subject, html });
      if (ok) sent++;
    }

    // Record notification sent
    await supabase
      .from("competition_notifications")
      .upsert(
        {
          competition_id:    comp.id,
          notification_date: today,
          notification_type: notificationKey,
        },
        { onConflict: "competition_id,notification_date,notification_type" }
      );

    results[comp.id] = { sent };
    totalSent += sent;
    console.log(`notify-survivor [${comp.id}]: sent ${sent} kickoff reveal emails for ${weekInfo.label}`);
  }

  return NextResponse.json({ totalSent, autoSubmitted, week: weekInfo.week, results });
}

// Converts auto_submit plan entries into real survivor picks.
//
// Only fires for members who are alive and have no pick for the week, and
// skips any team they've already used. Deliberately conservative: an
// auto-submit should never overwrite a deliberate pick or burn a team twice.
async function autoSubmitPlannedPicks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  weekInfo: { week: number; season: number },
  games: { id: string | number; homeTeam: { abbrev: string; name: string }; awayTeam: { abbrev: string; name: string } }[]
): Promise<number> {
  const { data: comps } = await supabase
    .from("competitions")
    .select("id")
    .eq("format", "survivor")
    .eq("status", "active");
  if (!comps || comps.length === 0) return 0;

  const compIds = comps.map((c) => c.id);

  const [{ data: plans }, { data: existingPicks }, { data: members }, { data: allPicks }] =
    await Promise.all([
      supabase
        .from("survivor_plans")
        .select("competition_id, user_id, team_abbrev")
        .in("competition_id", compIds)
        .eq("week_number", weekInfo.week)
        .eq("auto_submit", true),
      supabase
        .from("survivor_picks")
        .select("competition_id, user_id")
        .in("competition_id", compIds)
        .eq("week_number", weekInfo.week),
      supabase
        .from("competition_members")
        .select("competition_id, user_id, survivor_status")
        .in("competition_id", compIds),
      supabase
        .from("survivor_picks")
        .select("competition_id, user_id, team_abbrev")
        .in("competition_id", compIds),
    ]);

  if (!plans || plans.length === 0) return 0;

  const alreadyPicked = new Set(
    (existingPicks ?? []).map((p: any) => `${p.competition_id}__${p.user_id}`)
  );
  const alive = new Set(
    (members ?? [])
      .filter((m: any) => m.survivor_status === "alive")
      .map((m: any) => `${m.competition_id}__${m.user_id}`)
  );
  const usedTeams = new Set(
    (allPicks ?? []).map((p: any) => `${p.competition_id}__${p.user_id}__${p.team_abbrev}`)
  );

  // team abbrev → the game it plays in this week
  const gameByTeam = new Map<string, { id: string; name: string }>();
  for (const g of games) {
    gameByTeam.set(g.homeTeam.abbrev, { id: String(g.id), name: g.homeTeam.name });
    gameByTeam.set(g.awayTeam.abbrev, { id: String(g.id), name: g.awayTeam.name });
  }

  let submitted = 0;
  for (const plan of plans as any[]) {
    const memberKey = `${plan.competition_id}__${plan.user_id}`;
    if (alreadyPicked.has(memberKey)) continue;
    if (!alive.has(memberKey)) continue;
    if (usedTeams.has(`${memberKey}__${plan.team_abbrev}`)) continue;

    const game = gameByTeam.get(plan.team_abbrev);
    if (!game) continue; // bye week or team not playing — nothing to submit

    const { error } = await supabase.from("survivor_picks").upsert(
      {
        competition_id: plan.competition_id,
        user_id:        plan.user_id,
        season_year:    weekInfo.season,
        week_number:    weekInfo.week,
        game_id:        game.id,
        team_abbrev:    plan.team_abbrev,
        team_name:      game.name,
        result:         "pending",
        updated_at:     new Date().toISOString(),
      },
      { onConflict: "competition_id,user_id,week_number" }
    );

    if (!error) {
      submitted++;
      console.log(
        `notify-survivor: auto-submitted ${plan.team_abbrev} for user ${plan.user_id} ` +
        `in ${plan.competition_id} (week ${weekInfo.week})`
      );
    }
  }

  return submitted;
}
