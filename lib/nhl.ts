// Full team name lookup — used when the API doesn't return placeName/commonName.
const NHL_TEAM_NAMES: Record<string, string> = {
  ANA: "Anaheim Ducks",
  BOS: "Boston Bruins",
  BUF: "Buffalo Sabres",
  CGY: "Calgary Flames",
  CAR: "Carolina Hurricanes",
  CHI: "Chicago Blackhawks",
  COL: "Colorado Avalanche",
  CBJ: "Columbus Blue Jackets",
  DAL: "Dallas Stars",
  DET: "Detroit Red Wings",
  EDM: "Edmonton Oilers",
  FLA: "Florida Panthers",
  LAK: "Los Angeles Kings",
  MIN: "Minnesota Wild",
  MTL: "Montréal Canadiens",
  NSH: "Nashville Predators",
  NJD: "New Jersey Devils",
  NYI: "New York Islanders",
  NYR: "New York Rangers",
  OTT: "Ottawa Senators",
  PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins",
  SJS: "San Jose Sharks",
  SEA: "Seattle Kraken",
  STL: "St. Louis Blues",
  TBL: "Tampa Bay Lightning",
  TOR: "Toronto Maple Leafs",
  UTA: "Utah Hockey Club",
  VAN: "Vancouver Canucks",
  VGK: "Vegas Golden Knights",
  WSH: "Washington Capitals",
  WPG: "Winnipeg Jets",
};

function teamName(t: { abbrev: string; placeName?: { default?: string }; commonName?: { default?: string } }): string {
  const constructed = `${t.placeName?.default ?? ""} ${t.commonName?.default ?? ""}`.trim();
  return constructed || NHL_TEAM_NAMES[t.abbrev] || t.abbrev;
}

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
  homeScore?: number;
  awayScore?: number;
  // Live game info
  period?: number;        // 1, 2, 3, 4 (OT), 5 (SO)
  periodType?: string;    // 'REG', 'OT', 'SO'
  clock?: string;         // e.g. "14:32"
  inIntermission?: boolean;
};

export async function fetchNHLScheduleForDate(date: string, noCache = false): Promise<NHLGame[]> {
  // The "schedule" endpoint returns a week. The "score" endpoint returns a
  // single day with results — useful for both schedule and scoring.
  const url = `https://api-web.nhle.com/v1/score/${date}`;
  const fetchOpts = noCache
    ? { cache: "no-store" as const }
    : { next: { revalidate: 60 } };
  const res = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error(`NHL API error: ${res.status}`);
  const data = await res.json();
  const games = (data.games ?? []) as any[];
  return games.map((g) => ({
    id: g.id,
    startTimeUTC: g.startTimeUTC,
    gameState: g.gameState,
    homeTeam: { abbrev: g.homeTeam.abbrev, name: teamName(g.homeTeam), id: g.homeTeam.id },
    awayTeam: { abbrev: g.awayTeam.abbrev, name: teamName(g.awayTeam), id: g.awayTeam.id },
    homeScore: g.homeTeam.score,
    awayScore: g.awayTeam.score,
    period: g.period,
    periodType: g.periodDescriptor?.periodType,
    clock: g.clock?.timeRemaining,
    inIntermission: g.clock?.inIntermission ?? false,
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
