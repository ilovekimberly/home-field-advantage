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
// Passes the date to ESPN so historical/future weeks load correctly.
export async function fetchNFLScheduleForDate(date: string): Promise<SportGame[]> {
  // Convert YYYY-MM-DD to YYYYMMDD for ESPN
  const calendarDate = date.replace(/-/g, "");
  const { games } = await fetchNFLScoreboard({ calendarDate });
  return games;
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
