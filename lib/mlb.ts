import type { SportGame } from "./schedule";

type PitcherInfo = { name: string; era?: string };

function parsePitcher(pitcher: any): PitcherInfo | null {
  if (!pitcher?.fullName) return null;
  // Try to pull current-season ERA from the hydrated stats array.
  const seasonStats = (pitcher.stats ?? []).find(
    (s: any) => s.group?.displayName === "pitching"
  );
  const era = seasonStats?.stats?.era;
  const eraClean = era && era !== "-.--" && era !== "INF" && era !== "0.00" ? era : undefined;
  return { name: pitcher.fullName, era: eraClean };
}

function shortName(full: string): string {
  const parts = full.trim().split(" ");
  if (parts.length < 2) return full;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export { shortName };

export async function fetchMLBScheduleForDate(date: string): Promise<SportGame[]> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore,probablePitcher(stats)`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  const data = await res.json();

  const games: SportGame[] = [];
  // Track seen gamePks so we can detect when the API returns the same
  // gamePk for both games of a doubleheader and assign a synthetic unique ID.
  const seenPks = new Set<number>();

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

      // gameNumber is 1 or 2 for doubleheaders, undefined for single games.
      const gameNumber = g.doubleHeader === "Y" || g.doubleHeader === "S"
        ? (g.gameNumber ?? undefined)
        : undefined;

      // If the API reuses the same gamePk for both games of a doubleheader,
      // give Game 2 a synthetic ID so the two are treated as separate throughout
      // the system (picks table, odds matching, scoring, etc.).
      const isDuplicatePk = seenPks.has(g.gamePk);
      seenPks.add(g.gamePk);
      const gameId = isDuplicatePk || gameNumber === 2
        ? `${g.gamePk}-dh2`
        : g.gamePk;

      games.push({
        id: gameId,
        startTimeUTC: g.gameDate,
        gameNumber,
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
        homePitcher: parsePitcher(home?.probablePitcher),
        awayPitcher: parsePitcher(away?.probablePitcher),
      });
    }
  }
  return games;
}
