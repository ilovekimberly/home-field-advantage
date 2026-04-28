import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNFLScoreboard, getNFLWeekLockTime } from "@/lib/nfl";

// ── Types ──────────────────────────────────────────────────────────────────

type SurvivorMember = {
  userId: string;
  name: string;
  status: "alive" | "eliminated";
  eliminatedWeek: number | null;
  // Current week pick — only revealed once picks are locked
  thisPick: { teamAbbrev: string; teamName: string; result: string } | null;
  // All previous weeks' picks (always visible)
  history: Array<{
    week: number;
    teamAbbrev: string;
    teamName: string;
    result: string;
  }>;
};

// ── GET /api/survivor/[id] ─────────────────────────────────────────────────
// Returns all data needed for the SurvivorPickRoom UI:
//   weekInfo, games, lock time, user's pick, all members + their picks

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const competitionId = params.id;

  // Verify competition exists and is survivor format
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, name, sport, format, status, creator_id, tiebreaker, start_date, end_date")
    .eq("id", competitionId)
    .single();

  if (!comp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (comp.format !== "survivor") {
    return NextResponse.json({ error: "Not a survivor competition" }, { status: 400 });
  }

  // Verify user is a member
  const { data: membership } = await supabase
    .from("competition_members")
    .select("id, survivor_status, survivor_eliminated_week")
    .eq("competition_id", competitionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership && comp.creator_id !== user.id) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // Fetch current NFL week
  let weekInfo;
  let games;
  try {
    const result = await fetchNFLScoreboard();
    weekInfo = result.weekInfo;
    games = result.games;
  } catch (e) {
    console.error("survivor GET: NFL schedule fetch failed", e);
    return NextResponse.json({ error: "Could not fetch NFL schedule" }, { status: 503 });
  }

  const lockTime = getNFLWeekLockTime(games);
  const now = new Date();
  const isLocked = lockTime ? now >= new Date(lockTime) : false;

  // Load all survivor picks for this competition
  const admin = createSupabaseAdminClient();

  const { data: allPicks } = await admin
    .from("survivor_picks")
    .select("user_id, week_number, picked_team_abbrev, picked_team_name, result")
    .eq("competition_id", competitionId);

  // Load all members
  const { data: memberRows } = await admin
    .from("competition_members")
    .select("user_id, survivor_status, survivor_eliminated_week")
    .eq("competition_id", competitionId);

  const memberIds = (memberRows ?? []).map((r: any) => r.user_id as string);

  // Load profiles
  const { data: profiles } = memberIds.length > 0
    ? await admin.from("profiles").select("id, display_name").in("id", memberIds)
    : { data: [] };

  const profileMap = new Map(
    (profiles ?? []).map((p: any) => [p.id as string, (p.display_name as string) ?? "Member"])
  );

  // My pick this week
  const myCurrentPick =
    (allPicks ?? []).find(
      (p: any) => p.user_id === user.id && p.week_number === weekInfo.week
    ) ?? null;

  // All teams I've used in previous weeks
  const myUsedTeams = (allPicks ?? [])
    .filter((p: any) => p.user_id === user.id && p.week_number < weekInfo.week)
    .map((p: any) => p.picked_team_abbrev as string);

  // Build member list
  const members: SurvivorMember[] = (memberRows ?? []).map((row: any) => {
    const userId = row.user_id as string;
    const memberPicks = (allPicks ?? []).filter((p: any) => p.user_id === userId);

    // Previous weeks picks (always visible)
    const history = memberPicks
      .filter((p: any) => p.week_number < weekInfo.week)
      .map((p: any) => ({
        week:        p.week_number as number,
        teamAbbrev:  p.picked_team_abbrev as string,
        teamName:    p.picked_team_name as string,
        result:      p.result as string,
      }))
      .sort((a: any, b: any) => a.week - b.week);

    // Current week pick — hidden until locked (except for the user's own pick)
    const currentWeekPickRaw = memberPicks.find(
      (p: any) => p.week_number === weekInfo.week
    );
    let thisPick: SurvivorMember["thisPick"] = null;
    if (currentWeekPickRaw) {
      if (isLocked || userId === user.id) {
        thisPick = {
          teamAbbrev: currentWeekPickRaw.picked_team_abbrev as string,
          teamName:   currentWeekPickRaw.picked_team_name as string,
          result:     currentWeekPickRaw.result as string,
        };
      } else {
        // Show only that they've picked, not what
        thisPick = { teamAbbrev: "?", teamName: "Locked in", result: "pending" };
      }
    }

    return {
      userId,
      name:           profileMap.get(userId) ?? "Member",
      status:         (row.survivor_status as "alive" | "eliminated") ?? "alive",
      eliminatedWeek: row.survivor_eliminated_week as number | null,
      thisPick,
      history,
    };
  });

  // Normalize games for the response
  const gameList = games.map((g) => ({
    id:           String(g.id),
    startTimeUTC: g.startTimeUTC,
    homeTeam:     g.homeTeam,
    awayTeam:     g.awayTeam,
    gameState:    g.gameState,
    homeScore:    g.homeScore,
    awayScore:    g.awayScore,
  }));

  return NextResponse.json({
    competition: {
      id:         comp.id,
      name:       comp.name,
      status:     comp.status,
      tiebreaker: comp.tiebreaker,
    },
    weekInfo,
    games: gameList,
    lockTime,
    isLocked,
    myPick: myCurrentPick
      ? {
          teamAbbrev: myCurrentPick.picked_team_abbrev as string,
          teamName:   myCurrentPick.picked_team_name as string,
          result:     myCurrentPick.result as string,
          weekNumber: myCurrentPick.week_number as number,
        }
      : null,
    myUsedTeams,
    myStatus:         (membership?.survivor_status as "alive" | "eliminated") ?? "alive",
    myEliminatedWeek: membership?.survivor_eliminated_week as number | null,
    members,
  });
}

// ── POST /api/survivor/[id] ─────────────────────────────────────────────────
// Submit or update a survivor pick for the current week.
// Body: { teamAbbrev, teamName, weekNumber }

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const competitionId = params.id;
  const body = await req.json().catch(() => ({}));
  const { teamAbbrev, teamName, weekNumber } = body as {
    teamAbbrev?: string;
    teamName?: string;
    weekNumber?: number;
  };

  if (!teamAbbrev || !teamName || !weekNumber) {
    return NextResponse.json({ error: "teamAbbrev, teamName and weekNumber required" }, { status: 400 });
  }

  // Verify competition
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, format, status")
    .eq("id", competitionId)
    .single();

  if (!comp || comp.format !== "survivor") {
    return NextResponse.json({ error: "Not a survivor competition" }, { status: 400 });
  }
  if (comp.status === "cancelled" || comp.status === "complete") {
    return NextResponse.json({ error: "Competition is over" }, { status: 400 });
  }

  // Verify membership + alive status
  const { data: membership } = await supabase
    .from("competition_members")
    .select("id, survivor_status")
    .eq("competition_id", competitionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  if (membership.survivor_status === "eliminated") {
    return NextResponse.json({ error: "You have been eliminated" }, { status: 403 });
  }

  // Check lock time
  try {
    const { games } = await fetchNFLScoreboard();
    const lockTime = getNFLWeekLockTime(games);
    if (lockTime && new Date() >= new Date(lockTime)) {
      return NextResponse.json({ error: "Picks are locked for this week" }, { status: 403 });
    }
  } catch {
    // If schedule fetch fails, allow the pick (don't block on infra issues)
  }

  // Verify the team hasn't been used in a previous week
  const admin = createSupabaseAdminClient();
  const { data: previousPicks } = await admin
    .from("survivor_picks")
    .select("week_number, picked_team_abbrev")
    .eq("competition_id", competitionId)
    .eq("user_id", user.id)
    .lt("week_number", weekNumber);

  const usedAbbrevs = new Set((previousPicks ?? []).map((p: any) => p.picked_team_abbrev as string));
  if (usedAbbrevs.has(teamAbbrev)) {
    return NextResponse.json({ error: "You already used that team in a previous week" }, { status: 400 });
  }

  // Upsert the pick
  const { error: upsertError } = await admin
    .from("survivor_picks")
    .upsert(
      {
        competition_id:     competitionId,
        user_id:            user.id,
        week_number:        weekNumber,
        picked_team_abbrev: teamAbbrev,
        picked_team_name:   teamName,
        result:             "pending",
        updated_at:         new Date().toISOString(),
      },
      { onConflict: "competition_id,user_id,week_number" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
