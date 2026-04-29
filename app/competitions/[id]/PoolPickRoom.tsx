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
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <span>LIVE</span>
        <span className="font-bold text-slate-700">{g.awayScore} – {g.homeScore}</span>
        <span className="text-slate-400">{timeInfo}</span>
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

// ── Main component ─────────────────────────────────────────────────────────

export default function PoolPickRoom({
  competitionId,
  activeDate,
  games,
  allDatePicks,
  members,
  currentUserId,
  readOnly,
  sport,
}: {
  competitionId: string;
  activeDate: string;
  games: Game[];
  allDatePicks: PickRow[];
  members: Member[];
  currentUserId: string;
  readOnly?: boolean;
  sport?: string;
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

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {games.map((g) => {
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
              <span className="text-xs text-slate-400">
                {locked
                  ? (g.final ? "" : "🔒 Locked")
                  : new Date(g.startTimeUTC).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
              </span>
              <ScoreBadge g={g} />
            </div>

            {isFIFA ? (
              // ── FIFA: Away / Draw / Home ──────────────────────────────────
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
                    {FIFA_OUTCOMES.map(({ value, label }) => {
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
                        </div>
                      </button>
                    );
                  })}
                </div>

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
  );
}
