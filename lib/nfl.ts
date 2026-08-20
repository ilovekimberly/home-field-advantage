// NFL schedule fetcher using the ESPN public API.
// No auth required. Returns current-week schedule by default.
//
// ESPN endpoint:
//   https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
//   Optional params: ?dates=<year>&seasontype=<1|2|3>&week=<n>

import type { SportGame } from "./schedule";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

export type NFLWeekInfo = {
  week: number;
  season: number;
  // 1 = preseason, 2 = regular season, 3 = postseason
  seasonType: number;
  label: string; // e.g. "Week 3" or "Wild Card Weekend"
};

function normalizeGameState(status: any): string {
  const state: string = status?.type?.state ?? "pre";
  const completed: boolean = status?.type?.completed ?? false;
  if (completed || state === "post") return "FINAL";
  if (state === "in") return "LIVE";
  return "PRE";
}

export async function fetchNFLScoreboard(options?: {
  week?: number;
  season?: number;
  seasonType?: number;
  // YYYYMMDD — ESPN will return the week containing this date
  calendarDate?: string;
}): Promise<{ weekInfo: NFLWeekInfo; games: SportGame[] }> {
  const params: string[] = [];
  if (options?.calendarDate) {
    // Pass full date; ESPN resolves to the correct week automatically
    params.push(`dates=${options.calendarDate}`);
  } else {
    if (options?.season)     params.push(`dates=${options.season}`);
    if (options?.seasonType) params.push(`seasontype=${options.seasonType}`);
    if (options?.week)       params.push(`week=${options.week}`);
  }

  const url =
    `${ESPN_BASE}/scoreboard` +
    (params.length ? `?${params.join("&")}` : "");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN NFL API error ${res.status}`);
  const data = await res.json();

  const weekNum: number       = data.week?.number ?? 1;
  const seasonType: number    = data.season?.type ?? 2;
  const weekLabel: string     =
    seasonType === 3
      ? (data.week?.text ?? `Postseason Week ${weekNum}`)
      : `Week ${weekNum}`;

  const weekInfo: NFLWeekInfo = {
    week:       weekNum,
    season:     data.season?.year ?? new Date().getFullYear(),
    seasonType,
    label:      weekLabel,
  };

  const games: SportGame[] = (data.events ?? []).map((ev: any) => {
    const comp  = ev.competitions?.[0];
    const home  = comp?.competitors?.find((c: any) => c.homeAway === "home");
    const away  = comp?.competitors?.find((c: any) => c.homeAway === "away");
    const hScore = home?.score != null ? parseInt(home.score, 10) : undefined;
    const aScore = away?.score != null ? parseInt(away.score, 10) : undefined;

    return {
      id:           ev.id as string,
      startTimeUTC: ev.date as string,
      homeTeam: {
        abbrev: (home?.team?.abbreviation as string) ?? "?",
        name:   (home?.team?.displayName as string)  ?? "Unknown",
        id:     (home?.team?.id as string)            ?? "0",
      },
      awayTeam: {
        abbrev: (away?.team?.abbreviation as string) ?? "?",
        name:   (away?.team?.displayName as string)  ?? "Unknown",
        id:     (away?.team?.id as string)            ?? "0",
      },
      gameState: normalizeGameState(ev.status),
      homeScore: hScore,
      awayScore: aScore,
    };
  });

  return { weekInfo, games };
}

// Used by fetchScheduleForDate — returns the week containing `date`.
export async function fetchNFLScheduleForDate(date: string): Promise<SportGame[]> {
  const { games } = await fetchNFLForDate(date);
  return games;
}

function makeWeekLabel(weekInfo: NFLWeekInfo): string {
  if (weekInfo.seasonType === 1) return `Preseason ${weekInfo.label}`;
  if (weekInfo.seasonType === 3) return `Playoffs · ${weekInfo.label}`;
  return weekInfo.label; // e.g. "Week 3"
}

// Fetches ALL games for the current/closest NFL week.
// Uses Sleeper for the correct NFL week label (ESPN inflates preseason week
// numbers by 1 because it counts the Hall of Fame game as Week 1).
// Uses ESPN for the actual game data.
export async function fetchNFLCurrentWeek(): Promise<{ games: SportGame[]; weekLabel: string }> {
  // Fetch Sleeper state and ESPN week info in parallel.
  const [sleeperRes, espnProbe] = await Promise.all([
    fetch("https://api.sleeper.app/v1/state/nfl", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetchNFLScoreboard(), // no params → ESPN resolves to current week
  ]);

  const { weekInfo } = espnProbe;

  // Fetch the complete slate using ESPN's explicit week params.
  const { games } = await fetchNFLScoreboard({
    week:       weekInfo.week,
    season:     weekInfo.season,
    seasonType: weekInfo.seasonType,
  });

  // Build label: prefer Sleeper's display_week (correct NFL numbering).
  // Fall back to ESPN weekInfo if Sleeper is unavailable.
  let weekLabel: string;
  if (sleeperRes) {
    const displayWeek: number = sleeperRes.display_week ?? sleeperRes.week ?? weekInfo.week;
    const seasonType: string  = sleeperRes.season_type ?? "regular";
    if (seasonType === "pre")  weekLabel = `Preseason Week ${displayWeek}`;
    else if (seasonType === "post") weekLabel = `Playoffs · Week ${displayWeek}`;
    else weekLabel = `Week ${displayWeek}`;
  } else {
    weekLabel = makeWeekLabel(weekInfo);
  }

  return { games, weekLabel };
}

// Returns both games and a human-readable week label for a specific date.
// Use this for season/weekly competitions navigating to a specific past or future week.
// Uses a two-step ESPN query: probe with the date to get weekInfo, then fetch
// the complete week slate with explicit params.
export async function fetchNFLForDate(date: string): Promise<{ games: SportGame[]; weekLabel: string }> {
  const calendarDate = date.replace(/-/g, "");
  const month = new Date(date + "T12:00:00Z").getUTCMonth() + 1;
  const isPreseason = month === 8;

  // Step 1: probe with the date to resolve weekInfo.
  let probe = isPreseason
    ? await fetchNFLScoreboard({ calendarDate, seasonType: 1 })
    : await fetchNFLScoreboard({ calendarDate });

  if (isPreseason && probe.games.length === 0) {
    probe = await fetchNFLScoreboard({ calendarDate });
  }

  const { weekInfo } = probe;

  // Step 2: fetch the complete week using explicit params.
  const { games } = await fetchNFLScoreboard({
    week:       weekInfo.week,
    season:     weekInfo.season,
    seasonType: weekInfo.seasonType,
  });

  return { games, weekLabel: makeWeekLabel(weekInfo) };
}

// Returns the lock time = 1 hour before the earliest game this week.
export function getNFLWeekLockTime(games: SportGame[]): string | null {
  if (!games.length) return null;
  const sorted = [...games].sort((a, b) =>
    a.startTimeUTC.localeCompare(b.startTimeUTC)
  );
  const firstMs = new Date(sorted[0].startTimeUTC).getTime();
  return new Date(firstMs - 60 * 60 * 1000).toISOString();
}
