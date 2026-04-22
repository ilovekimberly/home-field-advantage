// Thin wrapper around The Odds API for NHL game totals.
// Docs: https://the-odds-api.com/liveapi/guides/v4/
//
// We fetch totals once per day and freeze them so the line doesn't move
// after players start picking.

export type GameLine = {
  homeTeam: string; // full name e.g. "Toronto Maple Leafs"
  awayTeam: string;
  commenceTime: string; // ISO timestamp
  totalLine: number;    // e.g. 5.5
};

// Preferred bookmakers in priority order — first one found wins.
const BOOKMAKER_PRIORITY = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "pointsbetus",
];

export async function fetchNHLTotals(): Promise<GameLine[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is not set");

  const url =
    `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/` +
    `?apiKey=${apiKey}&regions=us&markets=totals&oddsFormat=american`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Odds API error ${res.status}: ${body}`);
  }

  const data: any[] = await res.json();
  const lines: GameLine[] = [];

  for (const game of data) {
    const line = extractTotalLine(game.bookmakers ?? []);
    if (line !== null) {
      lines.push({
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        commenceTime: game.commence_time,
        totalLine: line,
      });
    }
  }

  return lines;
}

function extractTotalLine(bookmakers: any[]): number | null {
  // Try preferred bookmakers first, then fall back to any available.
  const ordered = [
    ...BOOKMAKER_PRIORITY.map((k) => bookmakers.find((b) => b.key === k)).filter(Boolean),
    ...bookmakers.filter((b) => !BOOKMAKER_PRIORITY.includes(b.key)),
  ];

  for (const bm of ordered) {
    const market = (bm.markets ?? []).find((m: any) => m.key === "totals");
    if (!market) continue;
    const over = market.outcomes?.find((o: any) => o.name === "Over");
    if (over?.point != null) return over.point;
  }
  return null;
}

// Match Odds API team names to NHL API team names.
// The Odds API uses full names like "Toronto Maple Leafs";
// the NHL API constructs names as "{city} {commonName}" which should match.
// We do a case-insensitive substring check as a fallback.
export function matchTeamName(oddsName: string, nhlName: string): boolean {
  const a = oddsName.toLowerCase().trim();
  const b = nhlName.toLowerCase().trim();
  return a === b || a.includes(b) || b.includes(a);
}
