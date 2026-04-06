"use client";
import { useState } from "react";
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
  draftOrder, playerAId, playerBId, currentUserId,
}: {
  competitionId: string;
  activeDate: string;
  games: Game[];
  existingPicks: Pick[];
  draftOrder: ("A" | "B")[];
  playerAId: string;
  playerBId: string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextIndex = existingPicks.length;
  const onTheClock = draftOrder[nextIndex];
  const onTheClockUserId = onTheClock === "A" ? playerAId : playerBId;
  const isMyTurn = onTheClockUserId === currentUserId && nextIndex < draftOrder.length;
  const draftDone = nextIndex >= draftOrder.length;

  const pickedGameIds = new Set(existingPicks.map((p) => p.game_id));

  async function makePick(gameId: number, teamAbbrev: string, teamName: string) {
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

  if (games.length === 0) {
    return <div className="text-slate-500 italic">No NHL games on {activeDate}.</div>;
  }

  return (
    <div>
      <div className="mb-3 text-sm">
        {draftDone ? (
          <span className="font-semibold text-green-700">All picks made for tonight ✓</span>
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
          const winner = g.winner;
          return (
            <li key={g.id} className="border rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">
                  {g.away.name} @ {g.home.name}
                </div>
                <div className="text-xs text-slate-500">
                  {new Date(g.startTimeUTC).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {g.final && winner && <> · Final: {winner} won</>}
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
              {!taken && (
                <div className="flex gap-2">
                  <button
                    disabled={!isMyTurn || busy}
                    onClick={() => makePick(g.id, g.away.abbrev, g.away.name)}
                    className="btn-ghost disabled:opacity-30"
                  >Pick {g.away.abbrev}</button>
                  <button
                    disabled={!isMyTurn || busy}
                    onClick={() => makePick(g.id, g.home.abbrev, g.home.name)}
                    className="btn-ghost disabled:opacity-30"
                  >Pick {g.home.abbrev}</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!draftDone && (
        <div className="mt-3 text-xs text-slate-500">
          Pick order tonight: {draftOrder.map((p, i) => (
            <span key={i} className={i === nextIndex ? "font-bold text-rink" : ""}>
              {p}{i < draftOrder.length - 1 ? " → " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
