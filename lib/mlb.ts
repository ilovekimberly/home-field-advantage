import type { SportGame } from "./schedule";

export async function fetchMLBScheduleForDate(date: string): Promise<SportGame[]> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  const data = await res.json();

  const games: SportGame[] = [];
  for (const dateEntry of data.dates ?? []) {
    for (const g of dateEntry.games ?? []) {
      const state = g.status?.detailedState ?? "";
      const abstractState = g.status?.abstractGameState ?? "";

      // Normalize to unified game state.
      let gameState = "FUT";
      if (abstractState === "Final" || state === "Final" || state === "Game Over") {
        gameState = "FINAL";
      } else if (abstractState === "Live" || state === "In Progress" || state === "Manager Challenge") {
        gameState = "LIVE";
      } else if (state === "Postponed") {
        gameState = "POSTPONED";
      }

      const home = g.teams?.home;
      const away = g.teams?.away;
      const linescore = g.linescore ?? {};

      // Inning info for live games.
      let clock: string | undefined;
      let period: number | undefined;
      if (gameState === "LIVE" && linescore.currentInning) {
        period = linescore.currentInning;
        const half = linescore.inningHalf === "Top" ? "Top" : "Bot";
        clock = `${half} ${linescore.currentInningOrdinal ?? period}`;
      }

      games.push({
        id: g.gamePk,
        startTimeUTC: g.gameDate,
        homeTeam: {
          abbrev: home?.team?.abbreviation ?? "HOM",
          name: home?.team?.name ?? "Home",
          id: home?.team?.id ?? 0,
        },
        awayTeam: {
          abbrev: away?.team?.abbreviation ?? "AWY",
          name: away?.team?.name ?? "Away",
          id: away?.team?.id ?? 0,
        },
        gameState,
        homeScore: home?.score,
        awayScore: away?.score,
        period,
        clock,
      });
    }
  }
  return games;
}
