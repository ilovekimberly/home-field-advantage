import type { SportGame } from "./schedule";

export async function fetchEPLScheduleForDate(date: string): Promise<SportGame[]> {
  // ESPN's public soccer scoreboard — no auth required.
  const espnDate = date.replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=${espnDate}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`EPL API error: ${res.status}`);
  const data = await res.json();

  const games: SportGame[] = [];
  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const statusState = event.status?.type?.state ?? "pre"; // pre | in | post
    const completed = event.status?.type?.completed ?? false;
    const description = event.status?.type?.description ?? "";

    let gameState = "FUT";
    if (completed || statusState === "post") {
      gameState = "FINAL";
    } else if (statusState === "in") {
      gameState = "LIVE";
    }

    const homeComp = competition.competitors?.find((c: any) => c.homeAway === "home");
    const awayComp = competition.competitors?.find((c: any) => c.homeAway === "away");

    // Period — EPL has 2 halves + extra time.
    const period = event.status?.period ?? undefined;
    const displayClock = event.status?.displayClock;
    const clock = gameState === "LIVE" && displayClock ? displayClock : undefined;

    // Half label for live display.
    let periodType: string | undefined;
    if (period === 1) periodType = "1H";
    else if (period === 2) periodType = "2H";
    else if (period === 3) periodType = "ET";
    else if (period === 4) periodType = "PKS";

    const homeScore = homeComp?.score != null ? Number(homeComp.score) : undefined;
    const awayScore = awayComp?.score != null ? Number(awayComp.score) : undefined;

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
      homeScore,
      awayScore,
      period,
      periodType,
      clock,
    });
  }
  return games;
}
