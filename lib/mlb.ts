import type { SportGame } from "./schedule";

type PitcherInfo = { name: string; era?: string };
type PitcherRaw = { id: number; name: string };

function parsePitcherRaw(pitcher: any): PitcherRaw | null {
  if (!pitcher?.id || !pitcher?.fullName) return null;
  return { id: pitcher.id, name: pitcher.fullName };
}

function shortName(full: string): string {
  const parts = full.trim().split(" ");
  if (parts.length < 2) return full;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export { shortName };

export type MLBTeamStat = {
  streak: string;   // e.g. "W3" or "L5"
  lastTen: string;  // e.g. "7-3"
};

// Keyed by team abbreviation, e.g. { "NYY": { streak: "W3", lastTen: "7-3" } }
export type MLBTeamStatsMap = Record<string, MLBTeamStat>;

export async function fetchMLBTeamStats(season: string): Promise<MLBTeamStatsMap> {
  const url = `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team,records`;
  const res = await fetch(url, { next: { revalidate: 3600 } }); // cache 1 hour
  if (!res.ok) return {};
  const data = await res.json();

  const map: MLBTeamStatsMap = {};
  for (const division of data.records ?? []) {
    for (const tr of division.teamRecords ?? []) {
      const abbrev = tr.team?.abbreviation;
      if (!abbrev) continue;
      const streakCode: string = tr.streak?.streakCode ?? "";
      const lastTenRecord = (tr.records?.splitRecords ?? []).find(
        (s: any) => s.type === "lastTen"
      );
      const lastTen = lastTenRecord
        ? `${lastTenRecord.wins}-${lastTenRecord.losses}`
        : "";
      map[abbrev] = { streak: streakCode, lastTen };
    }
  }
  return map;
}

export async function fetchMLBScheduleForDate(date: string): Promise<SportGame[]> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore,probablePitcher`;
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
        homePitcher: parsePitcherRaw(home?.probablePitcher) as any,
        awayPitcher: parsePitcherRaw(away?.probablePitcher) as any,
      });
    }
  }

  // Batch-fetch current-season ERA for all probable pitchers in one call.
  const pitcherIds = [
    ...new Set(
      games.flatMap((g) => [
        (g.homePitcher as any)?.id,
        (g.awayPitcher as any)?.id,
      ].filter(Boolean))
    ),
  ] as number[];

  if (pitcherIds.length > 0) {
    const season = date.slice(0, 4);
    try {
      const statsUrl = `https://statsapi.mlb.com/api/v1/people?personIds=${pitcherIds.join(",")}&hydrate=stats(group=[pitching],type=[season],season=${season})`;
      const statsRes = await fetch(statsUrl, { next: { revalidate: 3600 } });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const eraMap: Record<number, string> = {};
        for (const person of statsData.people ?? []) {
          const pitchingStats = (person.stats ?? []).find(
            (s: any) => s.group?.displayName === "pitching" && s.type?.displayName === "season"
          );
          const era: string | undefined = pitchingStats?.splits?.[0]?.stat?.era;
          if (era && era !== "-.--" && era !== "INF") {
            eraMap[person.id] = era;
          }
        }
        // Merge ERA back into game pitcher info.
        for (const game of games) {
          const hp = game.homePitcher as any;
          const ap = game.awayPitcher as any;
          if (hp?.id) game.homePitcher = { name: hp.name, era: eraMap[hp.id] };
          if (ap?.id) game.awayPitcher = { name: ap.name, era: eraMap[ap.id] };
        }
      }
    } catch {
      // ERA fetch failed — still return games, just without ERA.
      for (const game of games) {
        const hp = game.homePitcher as any;
        const ap = game.awayPitcher as any;
        if (hp?.id) game.homePitcher = { name: hp.name };
        if (ap?.id) game.awayPitcher = { name: ap.name };
      }
    }
  }

  return games;
}
