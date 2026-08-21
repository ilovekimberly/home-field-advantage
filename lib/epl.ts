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

// ESPN publishes the league's matchday calendar on every scoreboard response.
// For soccer it's `calendarType: "day"` — a flat list of dates that have
// fixtures, e.g. ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
// "2026-08-29", ...]. Consecutive dates belong to the same matchweek; a gap
// starts a new one. This correctly separates midweek rounds (which are their
// own matchweek) from weekend rounds.
async function fetchEPLCalendarDates(): Promise<string[]> {
  const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard";
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];
  const data = await res.json();
  const raw: string[] = data.leagues?.[0]?.calendar ?? [];
  return raw
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000
  );
}

// Group the flat matchday list into matchweeks (runs of consecutive dates).
function clusterMatchweeks(dates: string[]): string[][] {
  const weeks: string[][] = [];
  for (const d of dates) {
    const current = weeks[weeks.length - 1];
    if (current && daysBetween(current[current.length - 1], d) <= 1) {
      current.push(d);
    } else {
      weeks.push([d]);
    }
  }
  return weeks;
}

// Resolve the matchweek covering `date` (the Friday-snapped pick date).
// Returns the dates in that matchweek plus its 1-based number.
async function resolveMatchweek(
  date: string
): Promise<{ dates: string[]; number: number } | null> {
  const calendar = await fetchEPLCalendarDates();
  if (calendar.length === 0) return null;

  const weeks = clusterMatchweeks(calendar);

  // The pick date is snapped back to Friday, but a matchweek can start on a
  // Saturday or midweek. Accept the first matchweek that has any fixture in
  // the 7 days beginning at `date`.
  const windowEnd = new Date(date + "T00:00:00Z");
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 6);
  const endStr = windowEnd.toISOString().slice(0, 10);

  const idx = weeks.findIndex((w) => w.some((d) => d >= date && d <= endStr));
  if (idx === -1) return null;

  return { dates: weeks[idx], number: idx + 1 };
}

async function fetchDatesAndDedupe(dates: string[]): Promise<SportGame[]> {
  const results = await Promise.all(dates.map(fetchEPLForSingleDate));
  const seen = new Set<string>();
  return results.flat().filter((g) => {
    const key = String(g.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Fetch all EPL matches for the matchweek containing the given date, using
// ESPN's published calendar so Thursday fixtures and midweek rounds are
// included rather than assuming a fixed Fri–Mon window.
export async function fetchEPLGameweekForDate(date: string): Promise<SportGame[]> {
  const mw = await resolveMatchweek(date).catch(() => null);
  if (mw) return fetchDatesAndDedupe(mw.dates);

  // Fallback: original fixed Fri–Mon window.
  const fridayDt = new Date(getGameweekStartDate(date) + "T12:00:00Z");
  const dates: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const d = new Date(fridayDt);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return fetchDatesAndDedupe(dates);
}

// Same as above but also returns a display label, e.g. "Matchweek 1".
export async function fetchEPLGameweekWithLabel(
  date: string
): Promise<{ games: SportGame[]; weekLabel: string }> {
  const mw = await resolveMatchweek(date).catch(() => null);
  if (mw) {
    return {
      games: await fetchDatesAndDedupe(mw.dates),
      weekLabel: `Matchweek ${mw.number}`,
    };
  }
  const games = await fetchEPLGameweekForDate(date);
  const label = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
  return { games, weekLabel: `Gameweek of ${label}` };
}
