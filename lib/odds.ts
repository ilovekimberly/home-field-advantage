// Wrapper around The Odds API for NHL (and eventually MLB) game lines.
// Docs: https://the-odds-api.com/liveapi/guides/v4/
//
// Fetches h2h (moneyline), spreads, and totals in a single API call.
// Lines are frozen once per day before puck drop so they don't move during picks.

export type GameLine = {
  homeTeam: string;       // full name e.g. "Toronto Maple Leafs"
  awayTeam: string;
  commenceTime: string;   // ISO timestamp
  // Totals
  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
  // Moneyline (American odds, e.g. -150 / +130)
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  // Spread (home team perspective, e.g. homeSpread = -1.5, awaySpread = +1.5)
  homeSpread: number | null;
  awaySpread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
};

// Preferred bookmakers in priority order — first one with data wins.
const BOOKMAKER_PRIORITY = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "pointsbetus",
];

export async function fetchNHLGameLines(): Promise<GameLine[]> {
  return fetchGameLines("icehockey_nhl");
}

export async function fetchMLBGameLines(): Promise<GameLine[]> {
  return fetchGameLines("baseball_mlb");
}

// Keep old name as an alias for any existing imports.
export const fetchNHLTotals = fetchNHLGameLines;

async function fetchGameLines(sport: string): Promise<GameLine[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is not set");

  const url =
    `https://api.the-odds-api.com/v4/sports/${sport}/odds/` +
    `?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Odds API error ${res.status}: ${body}`);
  }

  const data: any[] = await res.json();
  const lines: GameLine[] = [];

  for (const game of data) {
    const bms = game.bookmakers ?? [];
    lines.push({
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      ...extractTotals(bms, game.home_team),
      ...extractMoneyline(bms, game.home_team, game.away_team),
      ...extractSpread(bms, game.home_team, game.away_team),
    });
  }

  return lines;
}

// ── Market extractors ──────────────────────────────────────────────────────

function preferredBookmakers(bookmakers: any[]): any[] {
  return [
    ...BOOKMAKER_PRIORITY.map((k) => bookmakers.find((b) => b.key === k)).filter(Boolean),
    ...bookmakers.filter((b) => !BOOKMAKER_PRIORITY.includes(b.key)),
  ];
}

function extractTotals(bookmakers: any[], _homeTeam: string) {
  for (const bm of preferredBookmakers(bookmakers)) {
    const market = (bm.markets ?? []).find((m: any) => m.key === "totals");
    if (!market) continue;
    const over  = market.outcomes?.find((o: any) => o.name === "Over");
    const under = market.outcomes?.find((o: any) => o.name === "Under");
    if (over?.point != null) {
      return {
        totalLine:  over.point as number,
        overOdds:   over.price  != null ? Math.round(over.price)  : null,
        underOdds:  under?.price != null ? Math.round(under.price) : null,
      };
    }
  }
  return { totalLine: null, overOdds: null, underOdds: null };
}

function extractMoneyline(bookmakers: any[], homeTeam: string, awayTeam: string) {
  for (const bm of preferredBookmakers(bookmakers)) {
    const market = (bm.markets ?? []).find((m: any) => m.key === "h2h");
    if (!market) continue;
    const home = market.outcomes?.find((o: any) => matchTeamName(o.name, homeTeam));
    const away = market.outcomes?.find((o: any) => matchTeamName(o.name, awayTeam));
    if (home?.price != null && away?.price != null) {
      return {
        homeMoneyline: Math.round(home.price) as number,
        awayMoneyline: Math.round(away.price) as number,
      };
    }
  }
  return { homeMoneyline: null, awayMoneyline: null };
}

function extractSpread(bookmakers: any[], homeTeam: string, awayTeam: string) {
  for (const bm of preferredBookmakers(bookmakers)) {
    const market = (bm.markets ?? []).find((m: any) => m.key === "spreads");
    if (!market) continue;
    const home = market.outcomes?.find((o: any) => matchTeamName(o.name, homeTeam));
    const away = market.outcomes?.find((o: any) => matchTeamName(o.name, awayTeam));
    if (home?.point != null && away?.point != null) {
      return {
        homeSpread:     home.point  as number,
        awaySpread:     away.point  as number,
        homeSpreadOdds: home.price  != null ? Math.round(home.price)  : null,
        awaySpreadOdds: away.price  != null ? Math.round(away.price)  : null,
      };
    }
  }
  return { homeSpread: null, awaySpread: null, homeSpreadOdds: null, awaySpreadOdds: null };
}

// ── Team name matching ─────────────────────────────────────────────────────
// The Odds API and NHL/MLB APIs use full names ("Toronto Maple Leafs").
// Case-insensitive substring match handles minor differences.
//
// ALIASES: some teams use different names across APIs (e.g. rebrands).
// Map from the canonical schedule-API name → the Odds API name.
const TEAM_NAME_ALIASES: Record<string, string> = {
  // Utah rebranded from "Utah Hockey Club" to "Utah Mammoth" for 2025-26
  "utah hockey club": "utah mammoth",
};

export function matchTeamName(oddsName: string, scheduleName: string): boolean {
  const a = oddsName.toLowerCase().trim();
  const b = scheduleName.toLowerCase().trim();
  // Direct or substring match
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Alias check: translate the schedule name and retry
  const aliased = TEAM_NAME_ALIASES[b];
  if (aliased) return a === aliased || a.includes(aliased) || aliased.includes(a);
  return false;
}
