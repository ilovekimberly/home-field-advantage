import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate } from "@/lib/schedule";
import { fetchNHLGameLines, fetchMLBGameLines, matchTeamName } from "@/lib/odds";

// GET /api/cron/fetch-lines
// Fetches today's game lines (totals + moneyline + spreads) from The Odds API
// for any sport that has active competitions today, and stores them in game_lines.
//
// Runs once daily around 5 PM ET (22:00 UTC) — well before evening game starts.
// Lines are frozen after fetch; players see the same line all day.

type SportKey = "NHL" | "MLB";

const SPORT_FETCHERS: Record<SportKey, () => Promise<any[]>> = {
  NHL: fetchNHLGameLines,
  MLB: fetchMLBGameLines,
};

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

  const today = new Date().toISOString().slice(0, 10);
  const supabase = createSupabaseAdminClient();

  // ── Determine which sports need lines fetched today ───────────────────
  // Include both 'active' and 'pending' competitions — lines should be ready
  // as soon as a competition is created, before an opponent joins.
  // No end_date filter — playoff runs extend past the original season cutoff.
  const { data: activeComps } = await supabase
    .from("competitions")
    .select("sport")
    .in("status", ["active", "pending"])
    .lte("start_date", today);

  const activeSports = Array.from(
    new Set((activeComps ?? []).map((c) => c.sport ?? "NHL"))
  ).filter((s) => s === "NHL" || s === "MLB") as SportKey[];

  if (activeSports.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active NHL or MLB competitions today" });
  }

  const results: Record<string, { stored: number; unmatched: number; total: number }> = {};

  for (const sport of activeSports) {
    // ── 1. Fetch today's schedule ────────────────────────────────────────
    let games;
    try {
      games = await fetchScheduleForDate(sport, today, true);
    } catch (e) {
      console.error(`fetch-lines: ${sport} schedule failed`, e);
      results[sport] = { stored: 0, unmatched: 0, total: 0 };
      continue;
    }

    if (!games || games.length === 0) {
      console.log(`fetch-lines: no ${sport} games today`);
      results[sport] = { stored: 0, unmatched: 0, total: 0 };
      continue;
    }

    // ── 2. Fetch odds lines ──────────────────────────────────────────────
    let oddsLines;
    try {
      oddsLines = await SPORT_FETCHERS[sport]();
    } catch (e) {
      console.error(`fetch-lines: Odds API failed for ${sport}`, e);
      results[sport] = { stored: 0, unmatched: 0, total: games.length };
      continue;
    }

    if (!oddsLines || oddsLines.length === 0) {
      console.log(`fetch-lines: no ${sport} lines from Odds API`);
      results[sport] = { stored: 0, unmatched: 0, total: games.length };
      continue;
    }

    // ── 3. Match games and upsert into game_lines ────────────────────────
    let stored = 0;
    let unmatched = 0;

    for (const game of games) {
      const matched = oddsLines.find(
        (o) =>
          matchTeamName(o.homeTeam, game.homeTeam.name) &&
          matchTeamName(o.awayTeam, game.awayTeam.name)
      );

      if (!matched) {
        console.warn(`fetch-lines: no odds match for ${game.awayTeam.name} @ ${game.homeTeam.name}`);
        unmatched++;
        continue;
      }

      const { error } = await supabase.from("game_lines").upsert(
        {
          game_id:          game.id,
          game_date:        today,
          home_team:        game.homeTeam.name,
          away_team:        game.awayTeam.name,
          fetched_at:       new Date().toISOString(),
          total_line:       matched.totalLine,
          over_odds:        matched.overOdds,
          under_odds:       matched.underOdds,
          home_ml:          matched.homeMoneyline,
          away_ml:          matched.awayMoneyline,
          home_spread:      matched.homeSpread,
          away_spread:      matched.awaySpread,
          home_spread_odds: matched.homeSpreadOdds,
          away_spread_odds: matched.awaySpreadOdds,
        },
        { onConflict: "game_id,game_date" }
      );

      if (error) {
        console.error(`fetch-lines: upsert failed for game ${game.id}`, error);
      } else {
        stored++;
      }
    }

    console.log(`fetch-lines [${sport}]: stored ${stored}, unmatched ${unmatched}, total ${games.length}`);
    results[sport] = { stored, unmatched, total: games.length };
  }

  return NextResponse.json({ results });
}
