"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Team = { abbrev: string; name: string; id: number };
type Game = {
  id: number;
  home: Team;
  away: Team;
  startTimeUTC: string;
  final: boolean;
  winner: string | null;
};
type Pick = {
  id: string;
  game_id: number;
  picker_id: string;
  picked_team_abbrev: string;
  picked_team_name: string;
  pick_index: number;
  result: string;
};

export default function PickRoom({
  competitionId, activeDate, games, existingPicks,
  draftOrder, playerAId, playerBId, currentUserId, waitingForDefer, readOnly,
}: {
  competitionId: string;
  activeDate: string;
  games: Game[];
  existingPicks: Pick[];
  draftOrder: ("A" | "B")[];
  playerAId: string;
  playerBId: string | null;
  currentUserId: string;
  waitingForDefer?: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Tick every 30 seconds so the "started" lock updates without a page refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const nextIndex = existingPicks.length;
  const onTheClock = draftOrder[nextIndex];
  const onTheClockUserId = onTheClock === "A" ? playerAId : playerBId;
  const isMyTurn = onTheClockUserId === currentUserId && nextIndex < draftOrder.length;
  const draftDone = nextIndex >= draftOrder.length;
  const pickedGameIds = new Set(existingPicks.map((p) => p.game_id));

  function gameStarted(startTimeUTC: string) {
    return new Date(startTimeUTC) <= now;
  }

  async function makePick(gameId: number, teamAbbrev: string, teamName: string) {
    if (!isMyTurn) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/competitions/${competitionId}/picks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameDate: activeDate, gameId, teamAbbrev, teamName, pickIndex: nextIndex }),
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

  if (games.length === 0) {
    return <div className="text-slate-500 italic">No NHL games on {activeDate}.</div>;
  }

  // Are ALL unpicked games already locked (started)?
  const allRemainingLocked = games
    .filter((g) => !pickedGameIds.has(g.id))
    .every((g) => gameStarted(g.startTimeUTC));

  return (
    <div>
      <div className="mb-3 text-sm">
        {readOnly ? (
          <span className="text-slate-400 italic">Past night — picks are locked.</span>
        ) : waitingForDefer ? (
          <span className="text-slate-500 italic">Picks are locked until the pick-priority player makes their choice above.</span>
        ) : draftDone ? (
          <span className="font-semibold text-green-700">All picks made for tonight ✓</span>
        ) : allRemainingLocked ? (
          <span className="font-semibold text-amber-600">All remaining games have started — no more picks tonight.</span>
        ) : isMyTurn ? (
          <span className="font-semibold text-rink">You're on the clock — pick a team.</span>
        ) : (
          <span className="text-slate-500">Waiting on the other player…</span>
        )}
        {error && <div className="text-red-600 mt-1">{error}</div>}
      </div>

      <ul className="grid gap-2">
        {games.map((g) => {
          const pick = existingPicks.find((p) => p.game_id === g.id);
          const taken = pickedGameIds.has(g.id);
          const started = gameStarted(g.startTimeUTC);
          const winner = g.winner;

          return (
            <li
              key={g.id}
              className={`border rounded-lg p-3 flex items-center justify-between ${
                started && !taken ? "opacity-60 bg-slate-50" : ""
              }`}
            >
              <div>
                <div className="font-semibold">
                  {g.away.name} @ {g.home.name}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span>
                    {new Date(g.startTimeUTC).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {started && !g.final && (
                    <span className="inline-block rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-xs font-medium">
                      In progress
                    </span>
                  )}
                  {g.final && winner && (
                    <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                      Final · {winner} won
                    </span>
                  )}
                </div>
                {pick && (
                  <div className="text-sm mt-1">
                    Picked: <b>{pick.picked_team_name}</b>
                    {g.final && winner && (
                      pick.picked_team_abbrev === winner
                        ? <span className="text-green-700"> ✓ win</span>
                        : <span className="text-red-700"> ✗ loss</span>
                    )}
                  </div>
                )}
              </div>

              {/* Pick buttons — hidden if already picked or game started */}
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
