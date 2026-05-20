import type { SportGame } from "./schedule";

// Fetches World Cup 2026 schedule for a given date using the ESPN API.
// Returns home/away/draw outcomes — "DRAW" is a valid pick_team_abbrev.
export async function fetchFIFAScheduleForDate(date: string): Promise<SportGame[]> {
  // ESPN date format: YYYYMMDD
  const espnDate = date.replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${espnDate}`;

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`FIFA/ESPN API error: ${res.status}`);
  const data = await res.json();

  const games: SportGame[] = [];

  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const home = competition.competitors?.find((c: any) => c.homeAway === "home");
    const away = competition.competitors?.find((c: any) => c.homeAway === "away");
    if (!home || !away) continue;

    // Detect knockout stage: ESPN marks it via notes containing round names,
    // or via the season type (3 = knockout/postseason for soccer tournaments).
    // Group stage = no round name in notes; knockout = "Round of 32", "QF", etc.
    const notes: string = (competition.notes ?? [])
      .map((n: any) => n.headline ?? "").join(" ").toLowerCase();
    const knockoutKeywords = ["round of", "quarter", "semi", "final", "knockout", "last 16", "last 8", "last 4"];
    const seasonType: number = data.season?.type ?? 2;
    const knockoutRound =
      seasonType === 3 ||
      knockoutKeywords.some((kw) => notes.includes(kw));

    // ESPN marks the winner with a boolean on the competitor object.
    // This is set after extra time / penalties in knockout games.
    const homeWins = home.winner === true;
    const awayWins = away.winner === true;
    const espnWinner: "home" | "away" | undefined =
      homeWins ? "home" : awayWins ? "away" : undefined;

    const statusType = competition.status?.type?.name ?? "";
    const completed   = competition.status?.type?.completed ?? false;
    const displayClock = competition.status?.displayClock;
    const period      = competition.status?.period;

    let gameState = "FUT";
    if (completed || statusType === "STATUS_FULL_TIME") {
      gameState = "FINAL";
    } else if (
      statusType === "STATUS_IN_PROGRESS" ||
      statusType === "STATUS_FIRST_HALF" ||
      statusType === "STATUS_HALFTIME" ||
      statusType === "STATUS_SECOND_HALF" ||
      statusType === "STATUS_EXTRA_TIME" ||
      statusType === "STATUS_PENALTY"
    ) {
      gameState = "LIVE";
    } else if (statusType === "STATUS_POSTPONED" || statusType === "STATUS_SUSPENDED") {
      gameState = "POSTPONED";
    }

    const homeScore = parseInt(home.score ?? "", 10);
    const awayScore = parseInt(away.score ?? "", 10);

    games.push({
      id: event.id,
      startTimeUTC: competition.date,
      homeTeam: {
        abbrev: home.team?.abbreviation ?? home.team?.shortDisplayName ?? "HOM",
        name:   home.team?.displayName ?? "Home",
        id:     home.team?.id ?? 0,
      },
      awayTeam: {
        abbrev: away.team?.abbreviation ?? away.team?.shortDisplayName ?? "AWY",
        name:   away.team?.displayName ?? "Away",
        id:     away.team?.id ?? 0,
      },
      gameState,
      homeScore:    isNaN(homeScore) ? undefined : homeScore,
      awayScore:    isNaN(awayScore) ? undefined : awayScore,
      period:       period ?? undefined,
      clock:        displayClock ?? undefined,
      knockoutRound: knockoutRound || undefined,
      espnWinner,
    });
  }

  return games;
}

// For FIFA, returns "HOME", "AWAY", or "DRAW" (not a team abbrev).
// Knockout games: uses ESPN's winner flag so penalty shootout results score
// correctly — scores are equal after 90 min but there is no DRAW outcome.
export function fifaOutcome(g: SportGame): "HOME" | "AWAY" | "DRAW" | null {
  if (g.gameState !== "FINAL") return null;

  // Prefer ESPN's explicit winner flag (set after extra time / penalties).
  if (g.espnWinner === "home") return "HOME";
  if (g.espnWinner === "away") return "AWAY";

  // Fall back to score comparison for group stage games where espnWinner
  // may not be set (draws are a real outcome there).
  if (g.homeScore == null || g.awayScore == null) return null;
  if (g.homeScore > g.awayScore) return "HOME";
  if (g.awayScore > g.homeScore) return "AWAY";

  // Only return DRAW in group stage — knockout games never end in a draw.
  return g.knockoutRound ? null : "DRAW";
}
