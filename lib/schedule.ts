// Unified sport game type — all sport fetchers return this shape.
export type SportGame = {
  id: number | string;
  startTimeUTC: string;
  homeTeam: { abbrev: string; name: string; id: number | string };
  awayTeam: { abbrev: string; name: string; id: number | string };
  // Unified states: 'FUT' | 'PRE' | 'LIVE' | 'CRIT' | 'FINAL' | 'OFF' | 'POSTPONED'
  gameState: string;
  homeScore?: number;
  awayScore?: number;
  period?: number;
  periodType?: string;
  clock?: string;
  inIntermission?: boolean;
};

export type SupportedSport = "NHL" | "MLB" | "EPL";

export const SPORT_CONFIG: Record<SupportedSport, {
  label: string;
  emoji: string;
  seasonEnd: (startYear: number) => string;
}> = {
  NHL: {
    label: "NHL Hockey",
    emoji: "🏒",
    seasonEnd: (y) => `${y}-04-15`,
  },
  MLB: {
    label: "MLB Baseball",
    emoji: "⚾",
    seasonEnd: (y) => `${y}-09-30`,
  },
  EPL: {
    label: "English Premier League",
    emoji: "⚽",
    // EPL season spans two calendar years — ends in May of the following year.
    seasonEnd: (y) => `${y + 1}-05-20`,
  },
};

export async function fetchScheduleForDate(sport: string, date: string): Promise<SportGame[]> {
  switch (sport) {
    case "NHL": {
      const { fetchNHLScheduleForDate } = await import("./nhl");
      const games = await fetchNHLScheduleForDate(date);
      // NHLGame is compatible with SportGame — cast it.
      return games as unknown as SportGame[];
    }
    case "MLB": {
      const { fetchMLBScheduleForDate } = await import("./mlb");
      return fetchMLBScheduleForDate(date);
    }
    case "EPL": {
      const { fetchEPLScheduleForDate } = await import("./epl");
      return fetchEPLScheduleForDate(date);
    }
    default:
      throw new Error(`Unsupported sport: ${sport}`);
  }
}

export function isFinalGame(g: SportGame): boolean {
  return (
    g.gameState === "FINAL" ||
    g.gameState === "OFF" ||
    g.gameState === "CRIT" // NHL sometimes uses CRIT for critical/final
  );
}

export function winnerAbbrevGame(g: SportGame): string | null {
  if (!isFinalGame(g) || g.homeScore == null || g.awayScore == null) return null;
  if (g.homeScore === g.awayScore) return null; // draw = push
  return g.homeScore > g.awayScore ? g.homeTeam.abbrev : g.awayTeam.abbrev;
}
