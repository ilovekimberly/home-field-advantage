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
type Pick = {
  id: string;
  game_id: number;
  picker_id: string;
  picked_team_abbrev: string;
  picked_team_name: string;
  pick_index: number;
  result: string;
  pick_type?: string;         // 'winner' | 'over_under'
  over_under_choice?: string; // 'over' | 'under'
  total_line?: number;
};

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function PickerChip({ name, isMe }: { name: string; isMe: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
      isMe ? "bg-rink text-white" : "bg-slate-200 text-slate-700"
    }`}>
      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
        isMe ? "bg-white/20" : "bg-slate-400 text-white"
      }`}>
        {initials(name)}
      </span>
      {name}
    </span>
  );
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
    const timeInfo = g.inIntermission
      ? `INT`
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

export default function PickRoom({
  competitionId, activeDate, games, existingPicks,
  draftOrder, playerAId, playerBId, playerAName, playerBName,
  currentUserId, waitingForDefer, readOnly,
  enableOverUnder, gameLines,
}: {
  competitionId: string;
  activeDate: string;
  games: Game[];
  existingPicks: Pick[];
  draftOrder: ("A" | "B")[];
  playerAId: string;
  playerBId: string | null;
  playerAName: string;
  playerBName: string;
  currentUserId: string;
  waitingForDefer?: boolean;
  readOnly?: boolean;
  enableOverUnder?: boolean;
  gameLines?: Record<string, number>; // game_id → total line
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Tick every 30 seconds to update game-start locks.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh every 60 seconds when any game is live.
  const hasLiveGames = games.some(
    (g) => g.gameState === "LIVE" || g.gameState === "CRIT"
  );
  useEffect(() => {
    if (!hasLiveGames) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [hasLiveGames, router]);

  const nextIndex = existingPicks.length;
  const onTheClock = draftOrder[nextIndex];
  const onTheClockUserId = onTheClock === "A" ? playerAId : playerBId;
  const isMyTurn = onTheClockUserId === currentUserId && nextIndex < draftOrder.length;
  const draftDone = nextIndex >= draftOrder.length;
  const pickedGameIds = new Set(existingPicks.map((p) => String(p.game_id)));

  function gameStarted(startTimeUTC: string) {
    return new Date(startTimeUTC) <= now;
  }

  async function makePick(gameId: number | string, teamAbbrev: string, teamName: string) {
    if (!isMyTurn) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/competitions/${competitionId}/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameDate: activeDate,
        gameId,
        teamAbbrev,
        teamName,
        pickIndex: nextIndex,
        pickType: "winner",
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to save pick");
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  async function makeOverUnderPick(
    gameId: number | string,
    choice: "over" | "under",
    line: number
  ) {
    if (!isMyTurn) return;
    setBusy(true); setError(null);
    const label = choice === "over" ? `Over ${line}` : `Under ${line}`;
    const res = await fetch(`/api/competitions/${competitionId}/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameDate: activeDate,
        gameId,
        teamAbbrev: choice.toUpperCase(),   // "OVER" or "UNDER"
        teamName: label,                     // "Over 5.5" or "Under 5.5"
        pickIndex: nextIndex,
        pickType: "over_under",
        overUnderChoice: choice,
        totalLine: line,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to save pick");
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  const allRemainingLocked = games.length === 0 || games
    .filter((g) => !pickedGameIds.has(String(g.id)))
    .every((g) => gameStarted(g.startTimeUTC));

  // Poll every 10 seconds while waiting for the opponent to pick.
  const waitingForOpponentPick = !readOnly && !draftDone && !isMyTurn && !waitingForDefer && !allRemainingLocked;
  useEffect(() => {
    if (!waitingForOpponentPick) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [waitingForOpponentPick, router]);

  if (games.length === 0) {
    return <div className="text-slate-500 italic">No NHL games on {activeDate}.</div>;
  }

  return (
    <div>
      <div className="mb-3 text-sm flex items-center justify-between">
        <span>
          {readOnly ? (
            <span className="text-slate-400 italic">Past night — picks are locked.</span>
          ) : waitingForDefer ? (
            <span className="text-slate-500 italic">Picks locked until pick-priority player makes their choice.</span>
          ) : draftDone ? (
            <span className="font-semibold text-green-700">All picks made for tonight ✓</span>
          ) : allRemainingLocked ? (
            <span className="font-semibold text-amber-600">All remaining games have started — no more picks tonight.</span>
          ) : isMyTurn ? (
            <span className="font-semibold text-rink">
              You're on the clock — {draftOrder.length - nextIndex} pick{draftOrder.length - nextIndex !== 1 ? "s" : ""} remaining.
            </span>
          ) : (
            <span className="text-slate-500">
              Waiting on the other player — {draftOrder.length - nextIndex} pick{draftOrder.length - nextIndex !== 1 ? "s" : ""} remaining.
            </span>
          )}
        </span>
        {hasLiveGames && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            Auto-updating
          </span>
        )}
      </div>

      {enableOverUnder && (
        <p className="text-xs text-slate-400 mb-3 bg-slate-50 rounded-lg px-3 py-2">
          ⚖️ <b>Over/Under available.</b> Use your pick slot on total goals instead of a winner.
          If the final total lands exactly on the line, the pick is a <b>loss</b>.
        </p>
      )}

      {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}

      <ul className="grid gap-2">
        {games.map((g) => {
          const pick = existingPicks.find((p) => String(p.game_id) === String(g.id));
          const taken = pickedGameIds.has(String(g.id));
          const started = gameStarted(g.startTimeUTC);
          const winner = g.winner;
          const isLive = g.gameState === "LIVE" || g.gameState === "CRIT";
          const line = gameLines?.[String(g.id)];
          const hasLine = enableOverUnder && line != null;

          const isOUPick = pick?.pick_type === "over_under";
          const isWinnerPick = !isOUPick;

          // For live/final O/U result display
          const finalTotal = g.final && g.homeScore != null && g.awayScore != null
            ? g.homeScore + g.awayScore
            : null;

          const ouResult = isOUPick && finalTotal != null && pick?.total_line != null
            ? (finalTotal === pick.total_line
                ? "loss"  // exact = loss per rules
                : finalTotal > pick.total_line
                  ? (pick.over_under_choice === "over" ? "win" : "loss")
                  : (pick.over_under_choice === "under" ? "win" : "loss"))
            : null;

          return (
            <li
              key={g.id}
              className={`border rounded-lg p-3 ${
                isLive ? "border-red-100 bg-red-50/30" :
                started && !taken ? "opacity-60 bg-slate-50" : ""
              }`}
            >
              {/* Game header */}
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">
                    {g.away.name} @ {g.home.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {!started && (
                      <span className="text-xs text-slate-500">
                        {new Date(g.startTimeUTC).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    <ScoreBadge g={g} />
                    {g.final && winner && (
                      <span className="text-xs text-slate-500">{winner} won</span>
                    )}
                  </div>

                  {/* Pick display */}
                  {pick && (() => {
                    const pickerIsA = pick.picker_id === playerAId;
                    const pickerName = pickerIsA ? playerAName : (playerBName || "Opponent");
                    const pickerIsMe = pick.picker_id === currentUserId;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <PickerChip name={pickerName} isMe={pickerIsMe} />
                        <span className="text-sm text-slate-600">
                          → <b>{pick.picked_team_name}</b>
                        </span>
                        {isWinnerPick && g.final && winner && (
                          pick.picked_team_abbrev === winner
                            ? <span className="text-green-700 text-sm">✓ win</span>
                            : <span className="text-red-600 text-sm">✗ loss</span>
                        )}
                        {isOUPick && g.final && ouResult && (
                          ouResult === "win"
                            ? <span className="text-green-700 text-sm">✓ win · {finalTotal} goals</span>
                            : <span className="text-red-600 text-sm">✗ loss · {finalTotal} goals</span>
                        )}
                        {isOUPick && isLive && finalTotal != null && (
                          <span className="text-slate-400 text-xs">({finalTotal} so far)</span>
                        )}
                        {isWinnerPick && isLive && g.homeScore != null && (
                          <span className="text-slate-400 text-xs">
                            ({pick.picked_team_abbrev === g.home.abbrev
                              ? `${g.homeScore} – ${g.awayScore}`
                              : `${g.awayScore} – ${g.homeScore}`})
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Winner pick buttons */}
                {!taken && !started && !readOnly && (
                  <div className="flex gap-2 shrink-0 ml-3">
                    <button
                      disabled={!isMyTurn || busy || waitingForDefer}
                      onClick={() => makePick(g.id, g.away.abbrev, g.away.name)}
                      className="btn-ghost disabled:opacity-30 text-sm"
                    >
                      {g.away.abbrev}
                    </button>
                    <button
                      disabled={!isMyTurn || busy || waitingForDefer}
                      onClick={() => makePick(g.id, g.home.abbrev, g.home.name)}
                      className="btn-ghost disabled:opacity-30 text-sm"
                    >
                      {g.home.abbrev}
                    </button>
                  </div>
                )}

                {!taken && started && (
                  <span className="text-xs text-slate-400 ml-3 shrink-0">🔒 Locked</span>
                )}
              </div>

              {/* Over/Under section */}
              {hasLine && (
                <div className={`mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 ${
                  taken && isWinnerPick ? "opacity-40" : ""
                }`}>
                  <span className="text-xs text-slate-500">
                    ⚖️ Total {line} goals
                    {g.final && finalTotal != null && (
                      <span className="ml-1 text-slate-400">· final: {finalTotal}</span>
                    )}
                  </span>
                  {!taken && !started && !readOnly && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={!isMyTurn || busy || waitingForDefer}
                        onClick={() => makeOverUnderPick(g.id, "over", line)}
                        className="btn-ghost disabled:opacity-30 text-xs px-2 py-1"
                      >
                        Over {line}
                      </button>
                      <button
                        disabled={!isMyTurn || busy || waitingForDefer}
                        onClick={() => makeOverUnderPick(g.id, "under", line)}
                        className="btn-ghost disabled:opacity-30 text-xs px-2 py-1"
                      >
                        Under {line}
                      </button>
                    </div>
                  )}
                  {taken && isOUPick && !started && (
                    <span className="text-xs text-slate-400">Picked</span>
                  )}
                  {!taken && started && (
                    <span className="text-xs text-slate-400">🔒</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!draftDone && !allRemainingLocked && (
        <div className="mt-3 text-xs text-slate-500">
          Pick order tonight:{" "}
          {draftOrder.map((p, i) => (
            <span key={i} className={i === nextIndex ? "font-bold text-rink" : ""}>
              {p}{i < draftOrder.length - 1 ? " → " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
