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
  gameNumber?: number;
};
type Pick = {
  id: string;
  game_id: number;
  picker_id: string;
  picked_team_abbrev: string;
  picked_team_name: string;
  pick_index: number;
  result: string;
  pick_type?: string;
  over_under_choice?: string;
  total_line?: number;
  spread_choice?: string;
  spread_line?: number;
};
type GameLineData = {
  totalLine?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  homeML?: number | null;
  awayML?: number | null;
  homeSpread?: number | null;
  awaySpread?: number | null;
  homeSpreadOdds?: number | null;
  awaySpreadOdds?: number | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatSpread(spread: number): string {
  return spread > 0 ? `+${spread}` : `${spread}`;
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

// ── Main component ─────────────────────────────────────────────────────────

export default function PickRoom({
  competitionId, activeDate, games, existingPicks,
  draftOrder, playerAId, playerBId, playerAName, playerBName,
  currentUserId, waitingForDefer, readOnly,
  enableOverUnder, enableSpread, gameLines, sport,
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
  enableSpread?: boolean;
  gameLines?: Record<string, GameLineData>;
  sport?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const hasLiveGames = games.some((g) => g.gameState === "LIVE" || g.gameState === "CRIT");
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

  const waitingForOpponentPick = !readOnly && !draftDone && !isMyTurn && !waitingForDefer
    && !games.filter((g) => !pickedGameIds.has(String(g.id))).every((g) => new Date(g.startTimeUTC) <= now);
  useEffect(() => {
    if (!waitingForOpponentPick) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [waitingForOpponentPick, router]);

  function gameStarted(startTimeUTC: string) {
    return new Date(startTimeUTC) <= now;
  }

  async function post(body: object) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/competitions/${competitionId}/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to save pick");
      setBusy(false);
      return false;
    }
    router.refresh();
    setBusy(false);
    return true;
  }

  async function makePick(gameId: number | string, teamAbbrev: string, teamName: string) {
    if (!isMyTurn) return;
    await post({ gameDate: activeDate, gameId, teamAbbrev, teamName, pickIndex: nextIndex, pickType: "winner" });
  }

  async function makeOverUnderPick(gameId: number | string, choice: "over" | "under", line: number) {
    if (!isMyTurn) return;
    await post({
      gameDate: activeDate, gameId,
      teamAbbrev: choice.toUpperCase(),
      teamName: `${choice === "over" ? "Over" : "Under"} ${line}`,
      pickIndex: nextIndex, pickType: "over_under",
      overUnderChoice: choice, totalLine: line,
    });
  }

  async function makeSpreadPick(gameId: number | string, choice: "home" | "away", spreadLine: number, teamAbbrev: string, label: string) {
    if (!isMyTurn) return;
    await post({
      gameDate: activeDate, gameId,
      teamAbbrev, teamName: label,
      pickIndex: nextIndex, pickType: "spread",
      spreadChoice: choice, spreadLine,
    });
  }

  const allRemainingLocked = games.length === 0 || games
    .filter((g) => !pickedGameIds.has(String(g.id)))
    .every((g) => gameStarted(g.startTimeUTC));

  if (games.length === 0) {
    return <div className="text-slate-500 italic">No games scheduled for {activeDate}.</div>;
  }

  const canPick = isMyTurn && !busy && !waitingForDefer;
  const hasAnyLines = enableOverUnder || enableSpread;

  return (
    <div>
      {/* Status line */}
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

      {/* Lines info banner */}
      {hasAnyLines && (
        <p className="text-xs text-slate-400 mb-3 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
          {enableSpread && enableOverUnder
            ? `⚖️ Spread and over/under picks available — use a pick slot on either instead of a winner. Push or exact total = loss.`
            : enableSpread
            ? `⚡ Spread picks available — use a pick slot on the ${sport === "MLB" ? "run line" : "puck line"} instead of a winner. Push = loss.`
            : `⚖️ Over/under picks available — use a pick slot on total ${sport === "MLB" ? "runs" : "goals"} instead of a winner. Exact total = loss.`}
        </p>
      )}

      {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}

      <ul className="grid gap-2">
        {games.map((g) => {
          const pick = existingPicks.find((p) => String(p.game_id) === String(g.id));
          const taken = pickedGameIds.has(String(g.id));
          const started = gameStarted(g.startTimeUTC);
          const isLive = g.gameState === "LIVE" || g.gameState === "CRIT";
          const line = gameLines?.[String(g.id)];

          // Don't show odds on Game 2 of a doubleheader — the Odds API only
          // returns one entry per matchup, so Game 2 lines would just be a copy
          // of Game 1's and may not be accurate.
          const isDoubleheaderGame2 = g.gameNumber === 2;
          const hasTotal  = enableOverUnder && line?.totalLine != null && !isDoubleheaderGame2;
          const hasSpread = enableSpread    && line?.homeSpread != null && line?.awaySpread != null && !isDoubleheaderGame2;
          const homeML = isDoubleheaderGame2 ? undefined : line?.homeML;
          const awayML = isDoubleheaderGame2 ? undefined : line?.awayML;

          const pickType = pick?.pick_type ?? "winner";
          const isOUPick     = pickType === "over_under";
          const isSpreadPick = pickType === "spread";
          const isWinnerPick = pickType === "winner";

          // O/U result
          const finalTotal = g.final && g.homeScore != null && g.awayScore != null
            ? g.homeScore + g.awayScore : null;
          const ouResult = isOUPick && finalTotal != null && pick?.total_line != null
            ? (finalTotal === pick.total_line ? "loss"
              : finalTotal > pick.total_line
                ? (pick.over_under_choice === "over" ? "win" : "loss")
                : (pick.over_under_choice === "under" ? "win" : "loss"))
            : null;

          // Spread result
          const spreadResult = isSpreadPick && g.final && pick?.spread_line != null
            && g.homeScore != null && g.awayScore != null
            ? (() => {
                const coverMargin = (g.homeScore - g.awayScore) + pick.spread_line;
                if (coverMargin === 0) return "loss";
                return pick.spread_choice === "home"
                  ? (coverMargin > 0 ? "win" : "loss")
                  : (coverMargin < 0 ? "win" : "loss");
              })()
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
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {g.away.name} @ {g.home.name}
                    {g.gameNumber != null && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                        Game {g.gameNumber}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {!started && (
                      <span className="text-xs text-slate-500">
                        {g.gameNumber === 2
                          ? "Follows Game 1"
                          : new Date(g.startTimeUTC).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    <ScoreBadge g={g} />
                    {g.final && g.winner && (
                      <span className="text-xs text-slate-500">{g.winner} won</span>
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
                        <span className="text-sm text-slate-600">→ <b>{pick.picked_team_name}</b></span>
                        {isWinnerPick && g.final && g.winner && (
                          pick.picked_team_abbrev === g.winner
                            ? <span className="text-green-700 text-sm">✓ win</span>
                            : <span className="text-red-600 text-sm">✗ loss</span>
                        )}
                        {isOUPick && g.final && ouResult && (
                          ouResult === "win"
                            ? <span className="text-green-700 text-sm">✓ win · {finalTotal} {sport === "MLB" ? "runs" : "goals"}</span>
                            : <span className="text-red-600 text-sm">✗ loss · {finalTotal} {sport === "MLB" ? "runs" : "goals"}</span>
                        )}
                        {isOUPick && isLive && finalTotal != null && (
                          <span className="text-slate-400 text-xs">({finalTotal} so far)</span>
                        )}
                        {isSpreadPick && g.final && spreadResult && (
                          spreadResult === "win"
                            ? <span className="text-green-700 text-sm">✓ win</span>
                            : <span className="text-red-600 text-sm">✗ loss</span>
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

                {/* Winner pick buttons with moneyline odds */}
                {!taken && !started && !readOnly && (
                  <div className="flex gap-2 shrink-0">
                    {([
                      { team: g.away, ml: awayML },
                      { team: g.home, ml: homeML },
                    ] as const).map(({ team, ml }) => (
                      <button
                        key={team.abbrev}
                        disabled={!canPick}
                        onClick={() => makePick(g.id, team.abbrev, team.name)}
                        className="btn-ghost disabled:opacity-30 text-sm flex flex-col items-center leading-tight px-3 py-1.5"
                      >
                        <span>{team.abbrev}</span>
                        {ml != null && (
                          <span className={`text-[10px] font-normal ${ml > 0 ? "text-green-600" : "text-slate-400"}`}>
                            {formatOdds(ml)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {!taken && started && (
                  <span className="text-xs text-slate-400 shrink-0">🔒 Locked</span>
                )}
              </div>

              {/* Over/Under section */}
              {hasTotal && (
                <div className={`mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 ${
                  taken && !isOUPick ? "opacity-40" : ""
                }`}>
                  <span className="text-xs text-slate-500">
                    ⚖️ Total {line!.totalLine}
                    {g.final && finalTotal != null && (
                      <span className="ml-1 text-slate-400">· final: {finalTotal}</span>
                    )}
                  </span>
                  {!taken && !started && !readOnly && (
                    <div className="flex gap-2 shrink-0">
                      {(["over", "under"] as const).map((choice) => {
                        const odds = choice === "over" ? line?.overOdds : line?.underOdds;
                        return (
                          <button
                            key={choice}
                            disabled={!canPick}
                            onClick={() => makeOverUnderPick(g.id, choice, line!.totalLine!)}
                            className="btn-ghost disabled:opacity-30 flex flex-col items-center leading-tight px-2 py-1"
                          >
                            <span className="text-xs">{choice === "over" ? "Over" : "Under"} {line!.totalLine}</span>
                            {odds != null && (
                              <span className={`text-[10px] font-normal ${odds > 0 ? "text-green-600" : "text-slate-400"}`}>
                                {formatOdds(odds)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {taken && isOUPick && !started && <span className="text-xs text-slate-400">Picked</span>}
                  {!taken && started && <span className="text-xs text-slate-400">🔒</span>}
                </div>
              )}

              {/* Spread section */}
              {hasSpread && (
                <div className={`mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 ${
                  taken && !isSpreadPick ? "opacity-40" : ""
                }`}>
                  <span className="text-xs text-slate-500">⚡ {sport === "MLB" ? "Run line" : "Puck line"}</span>
                  {!taken && !started && !readOnly && (
                    <div className="flex gap-2 shrink-0">
                      {([
                        { choice: "away" as const, team: g.away, spread: line!.awaySpread!, odds: line?.awaySpreadOdds },
                        { choice: "home" as const, team: g.home, spread: line!.homeSpread!, odds: line?.homeSpreadOdds },
                      ]).map(({ choice, team, spread, odds }) => (
                        <button
                          key={choice}
                          disabled={!canPick}
                          onClick={() => makeSpreadPick(
                            g.id, choice, line!.homeSpread!,
                            team.abbrev,
                            `${team.abbrev} ${formatSpread(spread)}`
                          )}
                          className="btn-ghost disabled:opacity-30 flex flex-col items-center leading-tight px-2 py-1"
                        >
                          <span className="text-xs">{team.abbrev} {formatSpread(spread)}</span>
                          {odds != null && (
                            <span className={`text-[10px] font-normal ${odds > 0 ? "text-green-600" : "text-slate-400"}`}>
                              {formatOdds(odds)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {taken && isSpreadPick && !started && <span className="text-xs text-slate-400">Picked</span>}
                  {!taken && started && <span className="text-xs text-slate-400">🔒</span>}
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
