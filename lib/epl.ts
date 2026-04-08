import type { SportGame } from "./schedule";

// Returns the ISO date of the Friday on or before the given date.
// EPL gameweeks typically run Friday → Monday.
export function getGameweekStartDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
  // Days to subtract to reach the previous (or current) Friday.
  const offset = day === 5 ? 0 : day === 6 ? 1 : day + 3; // Fri=0, Sat=1, Sun=2, Mon=3, Tue=4, Wed=5, Thu=6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

// Fetch EPL matches for a single calendar date.
async function fetchEPLForSingleDate(date: string): Promise<SportGame[]> {
  const espnDate = date.replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=${espnDate}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return [];
  const data = await res.json();
  return parseEPLEvents(data.events ?? []);
}

function parseEPLEvents(events: any[]): SportGame[] {
  const games: SportGame[] = [];
  for (const event of events) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const statusState = event.status?.type?.state ?? "pre";
    const completed = event.status?.type?.completed ?? false;

    let gameState = "FUT";
    if (completed || statusState === "post") gameState = "FINAL";
    else if (statusState === "in") gameState = "LIVE";

    const homeComp = competition.competitors?.find((c: any) => c.homeAway === "home");
    const awayComp = competition.competitors?.find((c: any) => c.homeAway === "away");

    const period = event.status?.period ?? undefined;
    const displayClock = event.status?.displayClock;
    const clock = gameState === "LIVE" && displayClock ? displayClock : undefined;

    let periodType: string | undefined;
    if (period === 1) periodType = "1H";
    else if (period === 2) periodType = "2H";
    else if (period === 3) periodType = "ET";
    else if (period === 4) periodType = "PKS";

    games.push({
      id: event.id,
      startTimeUTC: event.date,
      homeTeam: {
        abbrev: homeComp?.team?.abbreviation ?? "HOM",
        name: homeComp?.team?.displayName ?? "Home",
        id: homeComp?.team?.id ?? 0,
      },
      awayTeam: {
        abbrev: awayComp?.team?.abbreviation ?? "AWY",
        name: awayComp?.team?.displayName ?? "Away",
        id: awayComp?.team?.id ?? 0,
      },
      gameState,
      homeScore: homeComp?.score != null ? Number(homeComp.score) : undefined,
      awayScore: awayComp?.score != null ? Number(awayComp.score) : undefined,
      period,
      periodType,
      clock,
    });
  }
  return games;
}

// Fetch all EPL matches for the gameweek containing the given date.
// Covers Friday through the following Monday (4 days).
export async function fetchEPLGameweekForDate(date: string): Promise<SportGame[]> {
  const friday = getGameweekStartDate(date);
  const fridayDt = new Date(friday + "T12:00:00Z");

  // Build array of dates: Fri, Sat, Sun, Mon.
  const dates: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const d = new Date(fridayDt);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Fetch all days in parallel.
  const results = await Promise.all(dates.map(fetchEPLForSingleDate));
  const allGames = results.flat();

  // Deduplicate by game ID.
  const seen = new Set<string>();
  return allGames.filter((g) => {
    const key = String(g.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
