"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Team = { abbrev: string; name: string; id: number | string };
type Game = {
  id: number | string;
  home: Team;
  away: Team;
  startTimeUTC: string;
  gameState: string;
  final: boolean;
  winner: string | null;
  homeScore?: number;
  awayScore?: number;
  period?: number;
  periodType?: string;
  clock?: string;
  inIntermission?: boolean;
  // FIFA only: true for knockout stage games — Draw is not a valid outcome.
  knockoutRound?: boolean;
  // MLB only: 1 or 2 for doubleheaders, undefined for single games.
  gameNumber?: number;
};

type PickRow = {
  id: string;
  game_id: string;
  picker_id: string;
  picked_team_abbrev: string;
  picked_team_name: string;
  result: string;
};

type Member = { userId: string; name: string };

// ── Helpers ────────────────────────────────────────────────────────────────

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function periodLabel(period?: number, periodType?: string) {
  if (!period) return "";
  if (periodType === "OT") return "OT";
  if (periodType === "SO") return "SO";
  const suffixes = ["", "1st", "2nd", "3rd"];
  return suffixes[period] ?? `P${period}`;
}

function ScoreBadge({ g }: { g: Game }) {
  const isLive = g.gameState === "LIVE" || g.gameState === "CRIT";
  const isFinal = g.final;
  const hasScore = g.homeScore != null && g.awayScore != null;
  if (!hasScore && !isLive && !isFinal) return null;

  if (isFinal && hasScore) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        <span>Final</span>
        <span className="font-bold">{g.awayScore} – {g.homeScore}</span>
      </span>
    );
  }
  if (isLive && hasScore) {
    const period = periodLabel(g.period, g.periodType);
    const timeInfo = g.inIntermission ? "INT"
      : g.clock ? `${g.clock} · ${period}` : period;
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="shrink-0">LIVE</span>
        <span className="font-bold text-slate-700 shrink-0">{g.awayScore} – {g.homeScore}</span>
        <span className="text-slate-400 shrink-0">{timeInfo}</span>
      </span>
    );
  }
  return null;
}

function ResultIcon({ result }: { result: string }) {
  if (result === "win")  return <span className="text-green-500 font-bold text-xs">✓</span>;
  if (result === "loss") return <span className="text-red-400 font-bold text-xs">✗</span>;
  if (result === "push") return <span className="text-slate-400 text-xs">~</span>;
  return <span className="text-slate-300 text-xs">·</span>; // pending
}

// FIFA outcome labels
const FIFA_OUTCOMES = [
  { value: "AWAY", label: "Away" },
  { value: "DRAW", label: "Draw" },
  { value: "HOME", label: "Home" },
] as const;

// ── Picks reveal: shows all members' picks for a locked game ───────────────

function PicksReveal({
  gameId, allDatePicks, members, currentUserId, isFIFA, homeTeam, awayTeam,
}: {
  gameId: string;
  allDatePicks: PickRow[];
  members: Member[];
  currentUserId: string;
  isFIFA: boolean;
  homeTeam: Team;
  awayTeam: Team;
}) {
  const gamePicks = allDatePicks.filter((p) => String(p.game_id) === gameId);
  const pickByUser = new Map(gamePicks.map((p) => [p.picker_id, p]));

  function pickLabel(pick: PickRow): string {
    if (isFIFA) {
      if (pick.picked_team_abbrev === "HOME") return homeTeam.abbrev;
      if (pick.picked_team_abbrev === "AWAY") return awayTeam.abbrev;
      return "Draw";
    }
    // EPL stores draws as the "DRAW" sentinel alongside real team abbrevs.
    if (pick.picked_team_abbrev === "DRAW") return "Draw";
    return pick.picked_team_abbrev;
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
        Everyone's picks
      </p>
      <div className="space-y-1.5">
        {members.map((m) => {
          const pick = pickByUser.get(m.userId);
          const isMe = m.userId === currentUserId;

          return (
            <div key={m.userId} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${isMe ? "bg-rink/5" : ""}`}>
              {/* Avatar */}
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                isMe ? "bg-rink text-white" : "bg-slate-200 text-slate-600"
              }`}>
                {initials(m.name)}
              </div>

              {/* Name */}
              <span className={`text-xs truncate flex-1 min-w-0 ${isMe ? "font-semibold text-slate-700" : "text-slate-600"}`}>
                {isMe ? "You" : m.name}
              </span>

              {/* Pick + result */}
              {pick ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                    pick.result === "win"  ? "bg-green-100 text-green-700" :
                    pick.result === "loss" ? "bg-red-100 text-red-600" :
                    pick.result === "push" ? "bg-slate-100 text-slate-500" :
                    "bg-slate-50 text-slate-500"
                  }`}>
                    {pickLabel(pick)}
                  </span>
                  <ResultIcon result={pick.result} />
                </div>
              ) : (
                <span className="text-[10px] text-slate-300 italic shrink-0">no pick</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Picks grid: whole-slate view of every member's picks ───────────────────
// The per-game reveal is fine for a 1–2 game night, but a full NFL week or EPL
// matchweek runs 10–16 games — you'd have to scroll every card to compare.
// This shows the entire slate at once: members as rows, games as columns.
// Unlocked games stay hidden so nobody can copy before kickoff.

function PicksGrid({
  games, allDatePicks, members, currentUserId, isFIFA, now,
}: {
  games: Game[];
  allDatePicks: PickRow[];
  members: Member[];
  currentUserId: string;
  isFIFA: boolean;
  now: Date;
}) {
  const [open, setOpen] = useState(true);

  // Disambiguate columns that would otherwise look identical:
  //  · MLB doubleheaders — same two teams twice on one date → G1 / G2.
  //  · Any repeated pairing without a gameNumber → numbered by start time.
  const pairCounts = new Map<string, number>();
  for (const g of games) {
    const key = `${g.away.abbrev}@${g.home.abbrev}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const pairSeen = new Map<string, number>();

  // Multi-day slates (NFL weeks, EPL matchweeks) benefit from a day label —
  // it also tells apart a club playing twice in the same gameweek.
  const dayOf = (g: Game) =>
    new Date(g.startTimeUTC).toLocaleDateString("en-US", {
      weekday: "short", timeZone: "America/New_York",
    });
  const spansDays = new Set(games.map(dayOf)).size > 1;

  const rows = games.map((g) => {
    const key = `${g.away.abbrev}@${g.home.abbrev}`;
    const seq = (pairSeen.get(key) ?? 0) + 1;
    pairSeen.set(key, seq);
    const isRepeat = (pairCounts.get(key) ?? 0) > 1;
    return {
      game: g,
      locked: new Date(g.startTimeUTC) <= now || g.final
        || g.gameState === "LIVE" || g.gameState === "CRIT",
      // e.g. "G2" for the second leg of a doubleheader
      gameTag: isRepeat ? `G${g.gameNumber ?? seq}` : null,
      day: spansDays ? dayOf(g) : null,
    };
  });
  const anyLocked = rows.some((r) => r.locked);
  if (!anyLocked || members.length < 2) return null;

  const pickFor = (gameId: string, userId: string) =>
    allDatePicks.find(
      (p) => String(p.game_id) === gameId && p.picker_id === userId
    );

  function cellLabel(pick: PickRow, g: Game): string {
    if (isFIFA) {
      if (pick.picked_team_abbrev === "HOME") return g.home.abbrev;
      if (pick.picked_team_abbrev === "AWAY") return g.away.abbrev;
      return "Draw";
    }
    if (pick.picked_team_abbrev === "DRAW") return "Draw";
    return pick.picked_team_abbrev;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700">
          All picks · {rows.filter((r) => r.locked).length} of {games.length} revealed
        </span>
        <span className="text-xs text-slate-400">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold text-slate-500 border-b border-slate-100 min-w-[92px]">
                  Player
                </th>
                {rows.map(({ game: g, locked, gameTag, day }) => (
                  <th
                    key={String(g.id)}
                    className={`px-2 py-2 text-center font-medium border-b border-slate-100 whitespace-nowrap ${
                      locked ? "text-slate-500" : "text-slate-300"
                    }`}
                  >
                    {day && (
                      <div className="leading-tight text-[9px] uppercase tracking-wide text-slate-300">
                        {day}
                      </div>
                    )}
                    <div className="leading-tight">{g.away.abbrev}</div>
                    <div className="leading-tight text-[10px] text-slate-400">
                      @{g.home.abbrev}
                    </div>
                    {gameTag && (
                      <div className="leading-tight text-[9px] font-bold text-rink">
                        {gameTag}
                      </div>
                    )}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                  W–L
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isMe = m.userId === currentUserId;
                let w = 0, l = 0;
                for (const { game: g } of rows) {
                  const p = pickFor(String(g.id), m.userId);
                  if (p?.result === "win") w++;
                  else if (p?.result === "loss") l++;
                }
                return (
                  <tr key={m.userId} className={isMe ? "bg-rink/5" : ""}>
                    <td className={`sticky left-0 z-10 px-3 py-2 border-b border-slate-50 truncate max-w-[120px] ${
                      isMe ? "bg-[#f4f7fb] font-semibold text-slate-700" : "bg-white text-slate-600"
                    }`}>
                      {isMe ? "You" : m.name}
                    </td>
                    {rows.map(({ game: g, locked }) => {
                      const pick = pickFor(String(g.id), m.userId);
                      if (!locked) {
                        return (
                          <td key={String(g.id)} className="px-2 py-2 text-center border-b border-slate-50">
                            <span className="text-slate-300" title="Hidden until kickoff">🔒</span>
                          </td>
                        );
                      }
                      if (!pick) {
                        return (
                          <td key={String(g.id)} className="px-2 py-2 text-center border-b border-slate-50">
                            <span className="text-slate-300">–</span>
                          </td>
                        );
                      }
                      return (
                        <td key={String(g.id)} className="px-2 py-2 text-center border-b border-slate-50">
                          <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${
                            pick.result === "win"  ? "bg-green-100 text-green-700" :
                            pick.result === "loss" ? "bg-red-100 text-red-600" :
                            pick.result === "push" ? "bg-slate-100 text-slate-500" :
                            "bg-slate-50 text-slate-500"
                          }`}>
                            {cellLabel(pick, g)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center border-b border-slate-50 tabular-nums font-semibold text-slate-600 whitespace-nowrap">
                      {w}–{l}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type GameLineData = {
  homeML?: number | null;
  awayML?: number | null;
};

export default function PoolPickRoom({
  competitionId,
  activeDate,
  games,
  allDatePicks,
  members,
  currentUserId,
  readOnly,
  sport,
  gameLines = {},
}: {
  competitionId: string;
  activeDate: string;
  games: Game[];
  allDatePicks: PickRow[];
  members: Member[];
  currentUserId: string;
  readOnly?: boolean;
  sport?: string;
  gameLines?: Record<string, GameLineData>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const myPickMap = new Map(
    allDatePicks
      .filter((p) => p.picker_id === currentUserId)
      .map((p) => [String(p.game_id), p])
  );

  const isFIFA = sport === "FIFA";
  const isEPL  = sport === "EPL";

  async function submitPick(
    gameId: string | number,
    teamAbbrev: string,
    teamName: string,
    pickOutcome?: string
  ) {
    setBusy(String(gameId));
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/pool-picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameDate: activeDate,
          gameId: String(gameId),
          teamAbbrev,
          teamName,
          pickOutcome,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to submit pick");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  // Change pick: DELETE existing then POST the new one in sequence.
  async function changePick(
    gameId: string | number,
    teamAbbrev: string,
    teamName: string,
    pickOutcome?: string
  ) {
    setBusy(String(gameId));
    setError(null);
    try {
      const delRes = await fetch(`/api/competitions/${competitionId}/pool-picks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameDate: activeDate, gameId: String(gameId) }),
      });
      if (!delRes.ok) {
        const j = await delRes.json().catch(() => ({}));
        setError(j.error ?? "Failed to retract pick");
        return;
      }
      const postRes = await fetch(`/api/competitions/${competitionId}/pool-picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameDate: activeDate,
          gameId: String(gameId),
          teamAbbrev,
          teamName,
          pickOutcome,
        }),
      });
      if (!postRes.ok) {
        const j = await postRes.json().catch(() => ({}));
        setError(j.error ?? "Failed to submit pick");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function retractPick(gameId: string | number) {
    setBusy(String(gameId));
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/pool-picks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameDate: activeDate, gameId: String(gameId) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to retract pick");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  if (games.length === 0) {
    return (
      <p className="text-slate-400 text-sm">No games scheduled for this date.</p>
    );
  }

  // Schedule APIs don't return games in a dependable order, so sort by kickoff
  // first. Grouping below relies on Map insertion order, which means an
  // unsorted input put days (and times within a day) out of sequence.
  const sortedGames = [...games].sort((a, b) =>
    a.startTimeUTC.localeCompare(b.startTimeUTC)
  );

  // Group games by local ET date for NFL/EPL (slates span multiple days per week)
  const isNFL = sport === "NFL";
  const groupByDay = sport === "NFL" || sport === "EPL";
  type GameGroup = { dateLabel: string; games: typeof games };
  const gameGroups: GameGroup[] = [];
  if (groupByDay) {
    const groupMap = new Map<string, typeof games>();
    for (const g of sortedGames) {
      const dayKey = new Date(g.startTimeUTC).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
      });
      if (!groupMap.has(dayKey)) groupMap.set(dayKey, []);
      groupMap.get(dayKey)!.push(g);
    }
    // Insertion order is now chronological because sortedGames is.
    for (const [dateLabel, gs] of groupMap) {
      gameGroups.push({ dateLabel, games: gs });
    }
  } else {
    gameGroups.push({ dateLabel: "", games: sortedGames });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <PicksGrid
        games={sortedGames}
        allDatePicks={allDatePicks}
        members={members}
        currentUserId={currentUserId}
        isFIFA={isFIFA ?? false}
        now={now}
      />

      {gameGroups.map(({ dateLabel, games: dayGames }) => (
        <div key={dateLabel || "all"}>
          {groupByDay && dateLabel && (
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider pt-2 pb-1 border-b border-slate-100 mb-2">
              {dateLabel}
            </div>
          )}
          <div className="space-y-3">
      {dayGames.map((g) => {
        const gameIdStr = String(g.id);
        const myPick = myPickMap.get(gameIdStr);
        const started = new Date(g.startTimeUTC) <= now;
        const locked = started || g.final || g.gameState === "LIVE" || g.gameState === "CRIT";
        const isBusy = busy === gameIdStr;

        return (
          <div
            key={gameIdStr}
            className={`rounded-xl border px-4 py-3 transition-colors ${
              myPick
                ? myPick.result === "win"
                  ? "border-green-200 bg-green-50"
                  : myPick.result === "loss"
                  ? "border-red-200 bg-red-50"
                  : "border-rink/30 bg-rink/5"
                : "border-slate-200 bg-white"
            }`}
          >
            {/* Game header row */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs text-slate-400 min-w-0 truncate">
                {locked
                  ? (g.final ? "" : "🔒 Locked")
                  : new Date(g.startTimeUTC).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
              </span>
              <div className="shrink-0">
                <ScoreBadge g={g} />
              </div>
            </div>

            {isFIFA ? (
              // ── FIFA: Away / Draw / Home (Draw hidden in knockout rounds) ──
              <>
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="text-center flex-1 min-w-0 px-1">
                    <div className="text-xs text-slate-400 mb-0.5">Away</div>
                    <div className="font-semibold text-sm leading-tight truncate">{g.away.name}</div>
                    <div className="text-xs text-slate-400">{g.away.abbrev}</div>
                  </div>
                  <div className="text-slate-300 font-light text-lg shrink-0 mx-2">vs</div>
                  <div className="text-center flex-1 min-w-0 px-1">
                    <div className="text-xs text-slate-400 mb-0.5">Home</div>
                    <div className="font-semibold text-sm leading-tight truncate">{g.home.name}</div>
                    <div className="text-xs text-slate-400">{g.home.abbrev}</div>
                  </div>
                </div>

                {/* Knockout stage notice */}
                {g.knockoutRound && !locked && (
                  <p className="text-xs text-slate-400 text-center mb-2">
                    Knockout round — pick who advances (no draw)
                  </p>
                )}

                {locked ? (
                  <div className="text-center text-sm text-slate-500">
                    {myPick ? (
                      <span className="font-medium">
                        You picked:{" "}
                        <span className="text-rink font-bold">
                          {myPick.picked_team_abbrev === "HOME" ? g.home.name
                            : myPick.picked_team_abbrev === "AWAY" ? g.away.name
                            : "Draw"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">No pick made</span>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {FIFA_OUTCOMES
                      .filter(({ value }) => !(g.knockoutRound && value === "DRAW"))
                      .map(({ value, label }) => {
                        const isSelected = myPick?.picked_team_abbrev === value;
                        const teamName =
                          value === "HOME" ? g.home.name :
                          value === "AWAY" ? g.away.name : "Draw";
                        return (
                          <button
                            key={value}
                            disabled={isBusy || readOnly}
                            onClick={() =>
                              isSelected
                                ? retractPick(g.id)
                                : myPick
                                  ? changePick(g.id, value, teamName, value)
                                  : submitPick(g.id, value, teamName, value)
                            }
                            className={`flex-1 rounded-lg py-3 min-h-[44px] text-sm font-semibold transition-all ${
                              isSelected
                                ? "bg-rink text-white shadow-sm"
                                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            } disabled:opacity-50`}
                          >
                            {isBusy && isSelected ? "…" : label}
                            {value !== "DRAW" && (
                              <div className="text-xs font-normal opacity-75 mt-0.5">
                                {value === "HOME" ? g.home.abbrev : g.away.abbrev}
                              </div>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </>
            ) : (
              // ── Standard sport: Away vs Home ──────────────────────────────
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { team: g.away, side: "away" as const },
                    { team: g.home, side: "home" as const },
                  ].map(({ team, side }) => {
                    const isSelected = myPick?.picked_team_abbrev === team.abbrev;
                    const isWinner = g.winner === team.abbrev;
                    const line = gameLines[String(g.id)];
                    const ml = side === "away" ? line?.awayML : line?.homeML;

                    if (locked) {
                      return (
                        <div
                          key={side}
                          className={`rounded-lg px-3 py-2 text-center ${
                            isSelected
                              ? isWinner ? "bg-green-100 border border-green-300"
                                : myPick?.result === "loss" ? "bg-red-100 border border-red-300"
                                : "bg-rink/10 border border-rink/30"
                              : isWinner ? "bg-slate-50 border border-slate-200"
                              : "bg-slate-50 border border-slate-100 opacity-50"
                          }`}
                        >
                          <div className="font-bold text-sm">{team.abbrev}</div>
                          <div className="text-xs text-slate-500 truncate">{team.name}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {side === "away" ? "Away" : "Home"}
                            {ml != null && <span className="ml-1">{formatOdds(ml)}</span>}
                          </div>
                          {isSelected && (
                            <div className="mt-1 text-xs font-semibold text-slate-600">Your pick</div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <button
                        key={side}
                        disabled={isBusy || readOnly}
                        onClick={() =>
                          isSelected
                            ? retractPick(g.id)
                            : myPick
                              ? changePick(g.id, team.abbrev, team.name)
                              : submitPick(g.id, team.abbrev, team.name)
                        }
                        className={`rounded-lg px-3 py-3 min-h-[44px] text-center transition-all ${
                          isSelected
                            ? "bg-rink text-white shadow-sm"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        } disabled:opacity-50`}
                      >
                        <div className="font-bold text-sm">{team.abbrev}</div>
                        <div className={`text-xs truncate ${isSelected ? "text-white/80" : "text-slate-500"}`}>
                          {team.name}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${isSelected ? "text-white/60" : "text-slate-400"}`}>
                          {side === "away" ? "Away" : "Home"}
                          {ml != null && (
                            <span className={`ml-1 ${isSelected ? "text-white/60" : ml > 0 ? "text-green-600" : "text-slate-400"}`}>
                              {formatOdds(ml)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Draw — a real outcome in league soccer, so it's pickable.
                    Stored as the "DRAW" sentinel in picked_team_abbrev. */}
                {isEPL && (() => {
                  const isSelected = myPick?.picked_team_abbrev === "DRAW";
                  const wasDraw = g.final && g.homeScore != null && g.awayScore != null
                    && g.homeScore === g.awayScore;

                  if (locked) {
                    return (
                      <div className={`mt-2 rounded-lg px-3 py-2 text-center text-sm ${
                        isSelected
                          ? wasDraw ? "bg-green-100 border border-green-300"
                            : "bg-red-100 border border-red-300"
                          : wasDraw ? "bg-slate-50 border border-slate-200"
                          : "bg-slate-50 border border-slate-100 opacity-50"
                      }`}>
                        <span className="font-semibold text-slate-700">Draw</span>
                        {isSelected && (
                          <span className="ml-2 text-xs text-slate-600">Your pick</span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <button
                      disabled={isBusy || readOnly}
                      onClick={() =>
                        isSelected
                          ? retractPick(g.id)
                          : myPick
                            ? changePick(g.id, "DRAW", "Draw")
                            : submitPick(g.id, "DRAW", "Draw")
                      }
                      className={`mt-2 w-full rounded-lg px-3 py-2.5 min-h-[44px] text-sm font-semibold transition-all ${
                        isSelected
                          ? "bg-rink text-white shadow-sm"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      } disabled:opacity-50`}
                    >
                      {isBusy && isSelected ? "…" : "Draw"}
                    </button>
                  );
                })()}

                {myPick && !locked && (
                  <div className="mt-2 text-xs text-center text-slate-400">
                    <button
                      onClick={() => retractPick(g.id)}
                      disabled={!!busy || readOnly}
                      className="underline hover:text-slate-600"
                    >
                      Change pick
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Picks reveal — shown for all members once game locks */}
            {locked && members.length > 1 && (
              <PicksReveal
                gameId={gameIdStr}
                allDatePicks={allDatePicks}
                members={members}
                currentUserId={currentUserId}
                isFIFA={isFIFA ?? false}
                homeTeam={g.home}
                awayTeam={g.away}
              />
            )}
          </div>
        );
      })}
          </div>
        </div>
      ))}
    </div>
  );
}
