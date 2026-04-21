import { NextResponse } from "next/server";

export type SportPhase = {
  phase: "season" | "playoffs" | "offseason";
  seasonEndDate: string;   // last day of regular season
  playoffEndDate: string;  // last day of playoffs
  label: string;           // human-readable season option label
};

// ── NHL ──────────────────────────────────────────────────────────────────────
async function detectNHLPhase(today: string): Promise<SportPhase> {
  const year = parseInt(today.slice(0, 4));

  // Default fallback dates (overridden if API succeeds)
  let seasonEndDate = `${year}-04-20`;
  let playoffEndDate = `${year}-06-30`;

  // Try to get actual season end from standings-season endpoint.
  try {
    const res = await fetch("https://api-web.nhle.com/v1/standings-season", {
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      const seasons: any[] = data.seasons ?? [];
      // Find the season that contains today, or the most recent one.
      const current =
        seasons.find(
          (s: any) =>
            s.regularSeasonStartDate <= today &&
            (s.playoffEndDate ?? s.standingsEnd ?? "") >= today
        ) ?? seasons[seasons.length - 1];
      if (current?.regularSeasonEndDate) {
        seasonEndDate = current.regularSeasonEndDate.slice(0, 10);
      }
      if (current?.playoffEndDate) {
        playoffEndDate = current.playoffEndDate.slice(0, 10);
      }
    }
  } catch {
    // Use fallback dates.
  }

  // Detect phase from recent game types. Try today and up to 7 days back.
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    try {
      const res = await fetch(`https://api-web.nhle.com/v1/score/${date}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      const games: any[] = data.games ?? [];
      if (games.length === 0) continue;

      // gameType: 2 = regular season, 3 = playoffs
      if (games.some((g) => g.gameType === 3)) {
        return { phase: "playoffs", seasonEndDate, playoffEndDate, label: "Full playoffs" };
      }
      if (games.some((g) => g.gameType === 2)) {
        return { phase: "season", seasonEndDate, playoffEndDate, label: "Full regular season" };
      }
    } catch {
      continue;
    }
  }

  // Date-based fallback if no games found recently.
  const month = parseInt(today.slice(5, 7));
  if (month >= 4 && month <= 6) {
    return { phase: "playoffs", seasonEndDate, playoffEndDate, label: "Full playoffs" };
  }
  if (month >= 10 || month <= 3) {
    return { phase: "season", seasonEndDate, playoffEndDate, label: "Full regular season" };
  }
  return { phase: "offseason", seasonEndDate, playoffEndDate, label: "Full season" };
}

// ── MLB ───────────────────────────────────────────────────────────────────────
async function detectMLBPhase(today: string): Promise<SportPhase> {
  const year = parseInt(today.slice(0, 4));

  let seasonEndDate = `${year}-09-30`;
  let playoffEndDate = `${year}-11-05`;

  // Try to get actual season dates from MLB Stats API.
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/seasons?sportId=1&seasonId=${year}`,
      { cache: "no-store" }
    );
    if (res.ok) {
      const data = await res.json();
      const season = data.seasons?.[0];
      if (season?.regularSeasonEndDate) {
        seasonEndDate = season.regularSeasonEndDate.slice(0, 10);
      }
      if (season?.postSeasonEndDate) {
        playoffEndDate = season.postSeasonEndDate.slice(0, 10);
      }
    }
  } catch {
    // Use fallback dates.
  }

  // Detect phase from recent games. MLB gameType: "R" = regular, "D/L/W/F" = postseason.
  const postseasonTypes = new Set(["D", "L", "W", "F"]);

  for (let i = 0; i <= 7; i++) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    try {
      const res = await fetch(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const games: any[] = data.dates?.[0]?.games ?? [];
      if (games.length === 0) continue;

      if (games.some((g) => postseasonTypes.has(g.gameType))) {
        return { phase: "playoffs", seasonEndDate, playoffEndDate, label: "Full playoffs" };
      }
      if (games.some((g) => g.gameType === "R")) {
        return { phase: "season", seasonEndDate, playoffEndDate, label: "Full regular season" };
      }
    } catch {
      continue;
    }
  }

  // Date-based fallback.
  const month = parseInt(today.slice(5, 7));
  if (month >= 10 && month <= 11) {
    return { phase: "playoffs", seasonEndDate, playoffEndDate, label: "Full playoffs" };
  }
  if (month >= 4 && month <= 9) {
    return { phase: "season", seasonEndDate, playoffEndDate, label: "Full regular season" };
  }
  return { phase: "offseason", seasonEndDate, playoffEndDate, label: "Full season" };
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (sport === "NHL") {
      const result = await detectNHLPhase(today);
      return NextResponse.json(result);
    }
    if (sport === "MLB") {
      const result = await detectMLBPhase(today);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "unsupported sport" }, { status: 400 });
  } catch (e) {
    console.error("sport-phase: error", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
