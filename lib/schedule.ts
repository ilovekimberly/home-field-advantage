// Unified sport game type — all sport fetchers return this shape.
export type SportGame = {
  id: number | string;
  startTimeUTC: string;
  homeTeam: { abbrev: string; name: string; id: number | string };
  awayTeam: { abbrev: string; name: string; id: number | string };
  gameState: string;
  homeScore?: number;
  awayScore?: number;
  period?: number;
  periodType?: string;
  clock?: string;
  inIntermission?: boolean;
  // Doubleheader game number (1 or 2). Undefined for single games.
  gameNumber?: number;
  // Starting pitchers (MLB only)
  homePitcher?: { name: string; era?: string } | null;
  awayPitcher?: { name: string; era?: string } | null;
};

export type SupportedSport = "NHL" | "MLB" | "EPL" | "FIFA" | "NFL";

export const SPORT_CONFIG: Record<SupportedSport, {
  label: string;
  emoji: string;
  seasonEnd: (startYear: number) => string;
  // How picks are grouped — 'day' means one pick session per calendar day,
  // 'gameweek' means one pick session per weekly fixture round.
  pickCadence: "day" | "gameweek";
}> = {
  NHL: {
    label: "NHL Hockey",
    emoji: "🏒",
    seasonEnd: (y) => `${y}-04-15`,
    pickCadence: "day",
  },
  MLB: {
    label: "MLB Baseball",
    emoji: "⚾",
    seasonEnd: (y) => `${y}-09-30`,
    pickCadence: "day",
  },
  EPL: {
    label: "English Premier League",
    emoji: "⚽",
    seasonEnd: (y) => `${y + 1}-05-20`,
    pickCadence: "gameweek",
  },
  FIFA: {
    label: "World Cup",
    emoji: "🏆",
    seasonEnd: () => "2026-07-19",
    pickCadence: "day",
  },
  NFL: {
    label: "NFL Football",
    emoji: "🏈",
    // NFL regular season ends early January; survivor runs through Super Bowl
    seasonEnd: (y) => `${y + 1}-02-15`,
    pickCadence: "gameweek",
  },
};

// Returns the canonical "pick date" for a given sport and calendar date.
// For NHL/MLB this is the date itself. For EPL it's the Friday that starts
// the gameweek so all picks within the same gameweek share one game_date.
export function getPickDate(sport: string, date: string): string {
  if (sport === "EPL") {
    const { getGameweekStartDate } = require("./epl");
    return getGameweekStartDate(date);
  }
  return date;
}

// Fetch the full schedule for a sport on a given pick-date.
// For EPL, this returns the entire gameweek's fixtures.
export async function fetchScheduleForDate(sport: string, date: string, noCache = false): Promise<SportGame[]> {
  switch (sport) {
    case "NHL": {
      const { fetchNHLScheduleForDate } = await import("./nhl");
      const games = await fetchNHLScheduleForDate(date, noCache);
      return games as unknown as SportGame[];
    }
    case "MLB": {
      const { fetchMLBScheduleForDate } = await import("./mlb");
      return fetchMLBScheduleForDate(date);
    }
    case "EPL": {
      const { fetchEPLGameweekForDate } = await import("./epl");
      return fetchEPLGameweekForDate(date);
    }
    case "FIFA": {
      const { fetchFIFAScheduleForDate } = await import("./fifa");
      return fetchFIFAScheduleForDate(date);
    }
    case "NFL": {
      const { fetchNFLScheduleForDate } = await import("./nfl");
      return fetchNFLScheduleForDate(date);
    }
    default:
      throw new Error(`Unsupported sport: ${sport}`);
  }
}

export function isFinalGame(g: SportGame): boolean {
  return g.gameState === "FINAL" || g.gameState === "OFF";
}

export function winnerAbbrevGame(g: SportGame): string | null {
  if (!isFinalGame(g) || g.homeScore == null || g.awayScore == null) return null;
  if (g.homeScore === g.awayScore) return null; // draw = push
  return g.homeScore > g.awayScore ? g.homeTeam.abbrev : g.awayTeam.abbrev;
}
