import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate } from "@/lib/nhl";
import { fetchNHLGameLines, matchTeamName } from "@/lib/odds";

// GET /api/cron/fetch-lines
// Fetches today's NHL game lines (totals + moneyline + spreads) from The Odds API
// and stores them in the game_lines table, keyed by NHL game ID + date.
//
// Runs once daily around 5 PM ET (22:00 UTC) — well before evening puck drops.
// Lines are frozen after fetch; players see the same line all day.

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

  // ── 1. Fetch today's NHL schedule ─────────────────────────────────────
  let nhlGames;
  try {
    nhlGames = await fetchNHLScheduleForDate(today, true);
  } catch (e) {
    console.error("fetch-lines: NHL schedule failed", e);
    return NextResponse.json({ error: "NHL schedule API failed" }, { status: 502 });
  }

  if (!nhlGames || nhlGames.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No NHL games today" });
  }

  // ── 2. Fetch all lines from The Odds API ──────────────────────────────
  let oddsLines;
  try {
    oddsLines = await fetchNHLGameLines();
  } catch (e) {
    console.error("fetch-lines: Odds API failed", e);
    return NextResponse.json({ error: "Odds API failed" }, { status: 502 });
  }

  if (!oddsLines || oddsLines.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No lines available from Odds API" });
  }

  // ── 3. Match games and upsert into game_lines ─────────────────────────
  let stored = 0;
  let unmatched = 0;

  for (const nhlGame of nhlGames) {
    const matched = oddsLines.find(
      (o) =>
        matchTeamName(o.homeTeam, nhlGame.homeTeam.name) &&
        matchTeamName(o.awayTeam, nhlGame.awayTeam.name)
    );

    if (!matched) {
      console.warn(`fetch-lines: no odds match for ${nhlGame.awayTeam.name} @ ${nhlGame.homeTeam.name}`);
      unmatched++;
      continue;
    }

    const { error } = await supabase.from("game_lines").upsert(
      {
        game_id:          nhlGame.id,
        game_date:        today,
        home_team:        nhlGame.homeTeam.name,
        away_team:        nhlGame.awayTeam.name,
        fetched_at:       new Date().toISOString(),
        // Totals
        total_line:       matched.totalLine,
        over_odds:        matched.overOdds,
        under_odds:       matched.underOdds,
        // Moneyline
        home_ml:          matched.homeMoneyline,
        away_ml:          matched.awayMoneyline,
        // Spread
        home_spread:      matched.homeSpread,
        away_spread:      matched.awaySpread,
        home_spread_odds: matched.homeSpreadOdds,
        away_spread_odds: matched.awaySpreadOdds,
      },
      { onConflict: "game_id,game_date" }
    );

    if (error) {
      console.error(`fetch-lines: upsert failed for game ${nhlGame.id}`, error);
    } else {
      stored++;
    }
  }

  console.log(`fetch-lines: stored ${stored} lines, ${unmatched} unmatched out of ${nhlGames.length} games`);
  return NextResponse.json({ stored, unmatched, total: nhlGames.length });
}
