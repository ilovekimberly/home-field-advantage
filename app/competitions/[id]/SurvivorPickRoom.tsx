"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import SurvivorGrid from "./SurvivorGrid";

// ── Types ──────────────────────────────────────────────────────────────────

type Team = { abbrev: string; name: string };

type Game = {
  id: string;
  startTimeUTC: string;
  homeTeam: Team;
  awayTeam: Team;
  gameState: string; // PRE / LIVE / FINAL
  homeScore?: number;
  awayScore?: number;
};

type Pick = {
  teamAbbrev: string;
  teamName: string;
  result: string;
  weekNumber?: number;
};

type HistoryEntry = {
  week: number;
  teamAbbrev: string;
  teamName: string;
  result: string;
};

type Member = {
  userId: string;
  name: string;
  status: "alive" | "eliminated";
  eliminatedWeek: number | null;
  thisPick: Pick | null;
  history: HistoryEntry[];
};

type WeekInfo = {
  week: number;
  season: number;
  seasonType: number;
  label: string;
};

type SurvivorData = {
  competition: { id: string; name: string; status: string; tiebreaker: string | null };
  weekInfo: WeekInfo;
  games: Game[];
  lockTime: string | null;
  isLocked: boolean;
  myPick: Pick | null;
  myUsedTeams: string[];
  myStatus: "alive" | "eliminated";
  myEliminatedWeek: number | null;
  members: Member[];
  // Week navigation: which week is "now", and where the viewed week sits
  // relative to it. Future weeks are plan-only.
  currentWeek: number;
  isFutureWeek: boolean;
  isPastWeek: boolean;
  myPlan: { teamAbbrev: string; autoSubmit: boolean } | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function resultColor(result: string) {
  if (result === "win")  return "text-green-600";
  if (result === "loss") return "text-red-500";
  return "text-slate-400";
}

function resultIcon(result: string) {
  if (result === "win")  return "✓";
  if (result === "loss") return "✗";
  if (result === "pending") return "·";
  return "·";
}

function formatTime(utc: string) {
  return new Date(utc).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    timeZone: "America/New_York",
  });
}

function formatDate(utc: string) {
  return new Date(utc).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    timeZone: "America/New_York",
  });
}

function gameWinner(g: Game): string | null {
  if (g.gameState !== "FINAL") return null;
  if (g.homeScore == null || g.awayScore == null) return null;
  if (g.homeScore === g.awayScore) return null;
  return g.homeScore > g.awayScore ? g.homeTeam.abbrev : g.awayTeam.abbrev;
}

// ── Lock Countdown ─────────────────────────────────────────────────────────

function LockCountdown({ lockTime }: { lockTime: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function tick() {
      const diff = new Date(lockTime).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Locked"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(
        h > 0
          ? `${h}h ${m}m until lock`
          : m > 0
          ? `${m}m ${s}s until lock`
          : `${s}s until lock`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockTime]);

  return (
    <span className="text-xs text-amber-600 font-medium">{remaining}</span>
  );
}

// ── Score Badge ────────────────────────────────────────────────────────────

function ScoreBadge({ g }: { g: Game }) {
  const isLive  = g.gameState === "LIVE";
  const isFinal = g.gameState === "FINAL";
  if (!isLive && !isFinal) return null;
  if (g.homeScore == null || g.awayScore == null) return null;

  if (isFinal) {
    return (
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
        Final {g.awayScore}–{g.homeScore}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      LIVE {g.awayScore}–{g.homeScore}
    </span>
  );
}

// ── Game Card ─────────────────────────────────────────────────────────────

function GameCard({
  game,
  myPick,
  myUsedTeams,
  myStatus,
  isLocked,
  onPick,
  busy,
  planMode,
  plannedTeam,
}: {
  game: Game;
  myPick: Pick | null;
  myUsedTeams: string[];
  myStatus: "alive" | "eliminated";
  isLocked: boolean;
  onPick: (abbrev: string, name: string) => void;
  busy: boolean;
  // Plan mode: a future week, where clicking saves to the private plan rather
  // than committing a pick. The week is "locked" for real picks but still
  // interactive.
  planMode?: boolean;
  plannedTeam?: string | null;
}) {
  const winner = gameWinner(game);
  const isPicking = planMode
    ? myStatus === "alive"
    : myStatus === "alive" && !isLocked && !myPick;

  function TeamButton({ team }: { team: Team }) {
    const used      = myUsedTeams.includes(team.abbrev);
    // In plan mode the "selected" team is the planned one, not a committed pick.
    const isPicked  = planMode
      ? plannedTeam === team.abbrev
      : myPick?.teamAbbrev === team.abbrev;
    const isWinner  = winner === team.abbrev;
    const isLoser   = winner != null && winner !== team.abbrev;
    const canClick  = isPicking && !used;

    let border = "border-slate-200";
    if (isPicked)        border = "border-rink bg-ice";
    else if (used)       border = "border-slate-100 bg-slate-50";
    else if (isWinner)   border = "border-green-300 bg-green-50";
    else if (isLoser)    border = "border-red-200 bg-red-50/40";

    return (
      <button
        type="button"
        disabled={!canClick || busy}
        onClick={() => canClick && onPick(team.abbrev, team.name)}
        className={`relative flex-1 flex flex-col items-center gap-1.5 rounded-xl border-2 p-4 transition-colors
          ${border}
          ${canClick ? "hover:border-rink hover:bg-ice cursor-pointer" : "cursor-default"}
          ${used && !isPicked ? "opacity-40" : ""}
        `}
      >
        {/* Team abbrev */}
        <span className={`text-2xl font-black tracking-tight ${isPicked ? "text-rink" : "text-slate-800"}`}>
          {team.abbrev}
        </span>
        <span className={`text-xs text-center leading-tight ${isPicked ? "text-rink" : "text-slate-500"}`}>
          {team.name}
        </span>

        {/* Status overlays */}
        {isPicked && (
          <span className="absolute -top-2 -right-2 bg-rink text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
            {planMode ? "PLANNED" : "MY PICK"}
          </span>
        )}
        {used && !isPicked && (
          <span className="absolute -top-2 -right-2 bg-slate-400 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
            USED
          </span>
        )}
        {isWinner && (
          <span className="text-green-500 text-xs font-bold mt-0.5">WON</span>
        )}
        {isLoser && (
          <span className="text-red-400 text-xs font-bold mt-0.5">LOST</span>
        )}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400">
          {formatDate(game.startTimeUTC)} · {formatTime(game.startTimeUTC)}
        </span>
        <ScoreBadge g={game} />
      </div>
      <div className="flex items-center gap-3">
        <TeamButton team={game.awayTeam} />
        <span className="text-slate-400 font-medium text-sm flex-shrink-0">@</span>
        <TeamButton team={game.homeTeam} />
      </div>
    </div>
  );
}

// ── Survivor Leaderboard ───────────────────────────────────────────────────

function SurvivorBoard({
  members,
  weekInfo,
  isLocked,
}: {
  members: Member[];
  weekInfo: WeekInfo;
  isLocked: boolean;
}) {
  const alive      = members.filter((m) => m.status === "alive");
  const eliminated = members.filter((m) => m.status === "eliminated")
    .sort((a, b) => (b.eliminatedWeek ?? 0) - (a.eliminatedWeek ?? 0));

  // Collect all weeks that have been played
  const allWeeks = Array.from(
    new Set(members.flatMap((m) => m.history.map((h) => h.week)))
  ).sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">
        {alive.length} survivor{alive.length !== 1 ? "s" : ""} remaining
      </h2>

      {/* Roster — before the week locks there's nothing else listing who's in
          the pool (picks are hidden until lock, and the history table needs a
          completed week). Shows who has picked without revealing the team. */}
      {!isLocked && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              Players ({members.length})
            </span>
            <span className="text-xs text-slate-400">Picks reveal at lock</span>
          </div>
          <div className="divide-y divide-slate-100">
            {[...alive, ...eliminated].map((m) => (
              <div
                key={m.userId}
                className={`flex items-center justify-between px-4 py-3 ${
                  m.status === "eliminated" ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      m.status === "alive" ? "bg-green-400" : "bg-red-300"
                    }`}
                  />
                  <span className="text-sm font-medium">{m.name}</span>
                  {m.status === "eliminated" && (
                    <span className="text-xs text-slate-400">
                      (out Wk {m.eliminatedWeek})
                    </span>
                  )}
                </div>
                {m.status === "alive" && (
                  m.thisPick ? (
                    <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                      Picked
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 italic">No pick yet</span>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current week picks (revealed after lock) */}
      {isLocked && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-700">{weekInfo.label} picks</span>
          </div>
          <div className="divide-y divide-slate-100">
            {[...alive, ...eliminated].map((m) => {
              const pick = m.thisPick;
              return (
                <div
                  key={m.userId}
                  className={`flex items-center justify-between px-4 py-3 ${
                    m.status === "eliminated" ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        m.status === "alive" ? "bg-green-400" : "bg-red-300"
                      }`}
                    />
                    <span className="text-sm font-medium">{m.name}</span>
                    {m.status === "eliminated" && (
                      <span className="text-xs text-slate-400">
                        (out Wk {m.eliminatedWeek})
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    {pick ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700">
                          {pick.teamAbbrev}
                        </span>
                        <span className={`text-xs font-bold ${resultColor(pick.result)}`}>
                          {resultIcon(pick.result)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">no pick</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full pick history */}
      {allWeeks.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-700">Pick history</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium">Player</th>
                  {allWeeks.map((w) => (
                    <th
                      key={w}
                      className="text-center px-3 py-2.5 text-xs text-slate-500 font-medium"
                    >
                      Wk {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[...alive, ...eliminated].map((m) => (
                  <tr
                    key={m.userId}
                    className={m.status === "eliminated" ? "opacity-50" : ""}
                  >
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            m.status === "alive" ? "bg-green-400" : "bg-red-300"
                          }`}
                        />
                        {m.name}
                      </div>
                    </td>
                    {allWeeks.map((w) => {
                      const entry = m.history.find((h) => h.week === w);
                      return (
                        <td key={w} className="text-center px-3 py-2.5">
                          {entry ? (
                            <div className="flex flex-col items-center">
                              <span className="font-semibold text-xs">{entry.teamAbbrev}</span>
                              <span className={`text-[10px] font-bold ${resultColor(entry.result)}`}>
                                {resultIcon(entry.result)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SurvivorPickRoom({
  competitionId,
  userId,
}: {
  competitionId: string;
  userId: string;
}) {
  const router = useRouter();
  const [data, setData]   = useState<SurvivorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy]   = useState(false);
  // "pick" = this week's matchups, "grid" = full-season planning grid.
  const [view, setView]   = useState<"pick" | "grid">("pick");
  const [pickError, setPickError] = useState<string | null>(null);
  // Which week the pick page is showing. null = whatever week is current.
  const [viewWeek, setViewWeek] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = viewWeek != null ? `?week=${viewWeek}` : "";
      const res = await fetch(`/api/survivor/${competitionId}${qs}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to load survivor data");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Failed to load survivor data");
    } finally {
      setLoading(false);
    }
  }, [competitionId, viewWeek]);

  useEffect(() => {
    load();
    // Refresh every 60s to catch score updates
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  // On the current week this commits a real pick. On a future week there's
  // nothing to commit yet, so the same click saves it to your plan instead —
  // the exact rows the season grid reads and writes.
  async function submitPick(teamAbbrev: string, teamName: string) {
    if (!data) return;
    setBusy(true);
    setPickError(null);

    const planning = data.isFutureWeek === true;
    const clearing = planning && data.myPlan?.teamAbbrev === teamAbbrev;

    const res = planning
      ? await fetch(`/api/survivor/${competitionId}/plan`, {
          method: clearing ? "DELETE" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            clearing
              ? { weekNumber: data.weekInfo.week }
              : {
                  weekNumber: data.weekInfo.week,
                  teamAbbrev,
                  autoSubmit: data.myPlan?.autoSubmit ?? false,
                }
          ),
        })
      : await fetch(`/api/survivor/${competitionId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            teamAbbrev,
            teamName,
            weekNumber: data.weekInfo.week,
          }),
        });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setPickError(j.error ?? (planning ? "Failed to save plan" : "Failed to save pick"));
    } else {
      await load();
      if (!planning) router.refresh();
    }
    setBusy(false);
  }

  // Toggle auto-submit on the plan for the week being viewed.
  async function toggleAutoSubmit() {
    if (!data?.myPlan) return;
    setBusy(true);
    await fetch(`/api/survivor/${competitionId}/plan`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weekNumber: data.weekInfo.week,
        teamAbbrev: data.myPlan.teamAbbrev,
        autoSubmit: !data.myPlan.autoSubmit,
      }),
    });
    await load();
    setBusy(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="card text-center py-12 text-slate-400">
        Loading survivor league…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card text-center py-12 text-red-500">
        {error ?? "Something went wrong"}
      </div>
    );
  }

  const {
    weekInfo, games, lockTime, isLocked,
    myPick, myUsedTeams, myStatus, myEliminatedWeek,
    members, competition,
  } = data;

  const aliveCount = members.filter((m) => m.status === "alive").length;
  const tiebreakerLabel: Record<string, string> = {
    split:    "Split pot",
    riskiest: "Riskiest pick wins",
    playoffs: "Continues into playoffs",
    overtime: "Sudden death",
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {/* Title lives in the page header above (where the creator's
                rename control is), so it isn't repeated here. */}
            <p className="text-sm text-slate-500">
              🏈 NFL Survivor · {weekInfo.label}
              {competition.tiebreaker && (
                <span className="ml-2 text-slate-400">
                  · Tiebreaker: {tiebreakerLabel[competition.tiebreaker] ?? competition.tiebreaker}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`text-sm font-semibold px-3 py-1 rounded-full ${
                myStatus === "alive"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {myStatus === "alive"
                ? `🟢 Alive (${aliveCount} remaining)`
                : `💀 Eliminated — Week ${myEliminatedWeek}`}
            </span>
            {lockTime && !isLocked && (
              <LockCountdown lockTime={lockTime} />
            )}
            {isLocked && (
              <span className="text-xs text-slate-500">🔒 Picks locked</span>
            )}
          </div>
        </div>
      </div>

      {/* My status / pick prompt */}
      {myStatus === "alive" && !myPick && !isLocked && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Pick one team below to survive {weekInfo.label}. You cannot use a team you've already picked.
          </p>
        </div>
      )}

      {/* Missed-deadline warning. Only meaningful for the CURRENT week: other
          weeks report isLocked purely because they aren't pickable, which would
          otherwise make every future week look like an elimination. */}
      {myStatus === "alive" && !myPick && isLocked
        && !data.isFutureWeek && !data.isPastWeek && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">
            ⚠️ No pick made before the {weekInfo.label} deadline.
          </p>
          <p className="text-xs text-red-700 mt-1">
            You&apos;ll be eliminated when this week is scored. Set a pick in
            advance next week — the season grid lets you plan ahead and
            auto-submit.
          </p>
        </div>
      )}

      {myStatus === "alive" && myPick && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-sm text-slate-600">
              {isLocked ? "Your pick this week:" : "Your current pick (can change until lock):"}
            </span>
            <span className="ml-2 text-sm font-bold text-rink">
              {myPick.teamAbbrev} — {myPick.teamName}
            </span>
          </div>
          {myPick.result !== "pending" && (
            <span className={`text-sm font-bold ${resultColor(myPick.result)}`}>
              {myPick.result === "win" ? "✓ Won!" : "✗ Eliminated"}
            </span>
          )}
        </div>
      )}

      {pickError && (
        <p className="text-red-600 text-sm">{pickError}</p>
      )}

      {/* View switcher: this week's picks vs the season planning grid */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: "pick" as const, label: "This week" },
          { key: "grid" as const, label: "Season grid" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === t.key
                ? "border-rink text-rink"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === "grid" ? (
        <SurvivorGrid competitionId={competitionId} currentWeek={data.currentWeek ?? weekInfo.week} />
      ) : (
      <>
      {/* Week navigator — look ahead to plan future weeks without leaving
          the pick page. Only the current week can be picked for real. */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setViewWeek(Math.max(1, weekInfo.week - 1))}
          disabled={weekInfo.week <= 1 || busy}
          className="btn-ghost text-sm px-3 py-1 disabled:opacity-30"
        >
          ← Week {weekInfo.week - 1}
        </button>
        <div className="text-center">
          <div className="font-semibold text-rink">{weekInfo.label}</div>
          {data.isFutureWeek ? (
            <div className="text-xs text-slate-400">Planning ahead</div>
          ) : data.isPastWeek ? (
            <div className="text-xs text-slate-400">Past week</div>
          ) : (
            <div className="text-xs text-slate-400">This week</div>
          )}
        </div>
        <button
          onClick={() => setViewWeek(Math.min(18, weekInfo.week + 1))}
          disabled={weekInfo.week >= 18 || busy}
          className="btn-ghost text-sm px-3 py-1 disabled:opacity-30"
        >
          Week {weekInfo.week + 1} →
        </button>
      </div>

      {/* Plan banner for a future week */}
      {data.isFutureWeek && (
        <div className="rounded-lg bg-ice border border-rink/20 px-4 py-3 text-sm">
          {data.myPlan ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-700">
                Planned for {weekInfo.label}:{" "}
                <strong className="text-rink">{data.myPlan.teamAbbrev}</strong>
              </span>
              <button
                onClick={toggleAutoSubmit}
                disabled={busy}
                className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                  data.myPlan.autoSubmit
                    ? "bg-rink text-white border-rink"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                }`}
              >
                {data.myPlan.autoSubmit
                  ? "Auto-submit ON — will pick this at lock"
                  : "Auto-submit OFF — turn on"}
              </button>
            </div>
          ) : (
            <span className="text-slate-600">
              This is a future week. Choosing a team here saves it to your{" "}
              <strong>private plan</strong> — it isn&apos;t submitted as a pick.
            </span>
          )}
        </div>
      )}

      {/* Game matchup cards */}
      {games.length > 0 ? (
        <div>
          <h2 className="text-base font-semibold mb-3 text-slate-700">
            {weekInfo.label} matchups
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {games
              .sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC))
              .map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  myPick={myPick}
                  myUsedTeams={myUsedTeams}
                  myStatus={myStatus}
                  isLocked={isLocked}
                  onPick={submitPick}
                  busy={busy}
                  planMode={data.isFutureWeek === true}
                  plannedTeam={data.myPlan?.teamAbbrev ?? null}
                />
              ))}
          </div>
        </div>
      ) : (
        <div className="card text-center py-8 text-slate-400">
          No NFL games found for this week. Check back closer to game time.
        </div>
      )}

      {/* Survivor board */}
      {members.length > 0 && (
        <SurvivorBoard
          members={members}
          weekInfo={weekInfo}
          isLocked={isLocked}
        />
      )}
      </>
      )}
    </div>
  );
}
