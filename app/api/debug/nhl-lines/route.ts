import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNHLGameLines } from "@/lib/odds";
import { fetchScheduleForDate } from "@/lib/schedule";

// GET /api/debug/nhl-lines
// Diagnostic endpoint — shows exactly what The Odds API returns for NHL
// and what's currently stored in game_lines for today.
// Remove or protect this route before going to production.

export async function GET() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const supabase = createSupabaseAdminClient();

  // 1. Check which NHL competitions are active and within date range today
  const { data: activeComps } = await supabase
    .from("competitions")
    .select("id, name, sport, status, start_date, end_date")
    .eq("sport", "NHL")
    .eq("status", "active");

  const compsInRange = (activeComps ?? []).filter(
    (c) => c.start_date <= today && c.end_date >= today
  );
  const compsOutOfRange = (activeComps ?? []).filter(
    (c) => c.start_date > today || c.end_date < today
  );

  // 2. Fetch today's NHL schedule
  let scheduleGames: any[] = [];
  let scheduleError: string | null = null;
  try {
    scheduleGames = await fetchScheduleForDate("NHL", today, true);
  } catch (e: any) {
    scheduleError = e.message;
  }

  // 3. Fetch Odds API for NHL
  let oddsLines: any[] = [];
  let oddsError: string | null = null;
  try {
    oddsLines = await fetchNHLGameLines();
  } catch (e: any) {
    oddsError = e.message;
  }

  // 4. Check what's already stored in game_lines for today
  const { data: storedLines } = await supabase
    .from("game_lines")
    .select("game_id, game_date, home_team, away_team, total_line, home_ml, away_ml")
    .eq("game_date", today);

  // 5. Try to match each scheduled game to an odds line
  const matchDiagnostics = scheduleGames.map((game) => {
    const matched = oddsLines.find(
      (o) =>
        matchTeamName(o.homeTeam, game.homeTeam.name) &&
        matchTeamName(o.awayTeam, game.awayTeam.name)
    );
    return {
      game_id: game.id,
      home: game.homeTeam.name,
      away: game.awayTeam.name,
      startTimeUTC: game.startTimeUTC,
      matchedOdds: matched
        ? { totalLine: matched.totalLine, homeML: matched.homeMoneyline, awayML: matched.awayMoneyline }
        : null,
    };
  });

  return NextResponse.json({
    today,
    nhLCompetitions: {
      active: activeComps?.length ?? 0,
      inRange: compsInRange,
      outOfRange: compsOutOfRange,
    },
    schedule: {
      gameCount: scheduleGames.length,
      error: scheduleError,
    },
    oddsApi: {
      gameCount: oddsLines.length,
      error: oddsError,
      games: oddsLines.map((o) => ({ home: o.homeTeam, away: o.awayTeam, totalLine: o.totalLine })),
    },
    matching: matchDiagnostics,
    storedInGameLines: storedLines ?? [],
  });
}

function matchTeamName(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return x === y || x.includes(y) || y.includes(x);
}
