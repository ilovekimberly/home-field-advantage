// Thin wrapper around the public NHL schedule API.
// Endpoint format (no auth required):
//   https://api-web.nhle.com/v1/schedule/YYYY-MM-DD
// Returns a week's schedule starting on the given date. We pull a single day
// out of it and normalize the fields we care about.

export type NHLGame = {
  id: number;            // gamePk
  startTimeUTC: string;  // ISO timestamp
  homeTeam: { abbrev: string; name: string; id: number };
  awayTeam: { abbrev: string; name: string; id: number };
  // 'FUT' = future, 'PRE' = pregame, 'LIVE' = in progress, 'OFF'/'FINAL' = done
  gameState: string;
  // Filled when game ends
  homeScore?: number;
  awayScore?: number;
};

export async function fetchNHLScheduleForDate(date: string): Promise<NHLGame[]> {
  // The "schedule" endpoint returns a week. The "score" endpoint returns a
  // single day with results — useful for both schedule and scoring.
  const url = `https://api-web.nhle.com/v1/score/${date}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`NHL API error: ${res.status}`);
  const data = await res.json();
  const games = (data.games ?? []) as any[];
  return games.map((g) => ({
    id: g.id,
    startTimeUTC: g.startTimeUTC,
    gameState: g.gameState,
    homeTeam: {
      abbrev: g.homeTeam.abbrev,
      name: `${g.homeTeam.placeName?.default ?? ""} ${g.homeTeam.commonName?.default ?? g.homeTeam.abbrev}`.trim(),
      id: g.homeTeam.id,
    },
    awayTeam: {
      abbrev: g.awayTeam.abbrev,
      name: `${g.awayTeam.placeName?.default ?? ""} ${g.awayTeam.commonName?.default ?? g.awayTeam.abbrev}`.trim(),
      id: g.awayTeam.id,
    },
    homeScore: g.homeTeam.score,
    awayScore: g.awayTeam.score,
  }));
}

export function isFinal(state: string) {
  return state === "OFF" || state === "FINAL";
}

export function winnerAbbrev(g: NHLGame): string | null {
  if (!isFinal(g.gameState) || g.homeScore == null || g.awayScore == null) return null;
  if (g.homeScore === g.awayScore) return null;
  return g.homeScore > g.awayScore ? g.homeTeam.abbrev : g.awayTeam.abbrev;
}
