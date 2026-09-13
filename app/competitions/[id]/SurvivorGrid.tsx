"use client";
import { useState, useEffect, useCallback, useMemo } from "react";

type GridCell = {
  week: number;
  opponent: string;
  isHome: boolean;
  gameId: string;
  startTimeUTC: string;
  final: boolean;
  won: boolean | null;
};

type SeasonGrid = {
  season: number;
  weeks: number[];
  teams: Record<string, Record<number, GridCell>>;
  teamNames: Record<string, string>;
};

type PlanEntry = { week_number: number; team_abbrev: string; auto_submit: boolean };
type PickEntry = { week_number: number; team_abbrev: string; result: string };

// Survivor season grid: teams down the side, weeks across the top. Click a
// cell to plan that team for that week. Your plan is private.
export default function SurvivorGrid({
  competitionId,
  currentWeek,
}: {
  competitionId: string;
  currentWeek: number;
}) {
  const [grid, setGrid] = useState<SeasonGrid | null>(null);
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [picks, setPicks] = useState<PickEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyWeek, setBusyWeek] = useState<number | null>(null);
  const [hideAway, setHideAway] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/survivor/${competitionId}/plan`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Couldn't load the grid");
        return;
      }
      const data = await res.json();
      setGrid(data.grid);
      setPlan(data.plan ?? []);
      setPicks(data.picks ?? []);
      setError(null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => { load(); }, [load]);

  // week → planned team, and team → week for quick lookups while rendering.
  const planByWeek = useMemo(
    () => new Map(plan.map((p) => [p.week_number, p])),
    [plan]
  );
  const plannedTeams = useMemo(
    () => new Map(plan.map((p) => [p.team_abbrev, p.week_number])),
    [plan]
  );
  // Teams spent on committed picks — unavailable for the rest of the season.
  const usedTeams = useMemo(
    () => new Map(picks.map((p) => [p.team_abbrev, p.week_number])),
    [picks]
  );

  async function setPlanCell(week: number, team: string) {
    const existing = planByWeek.get(week);
    const clearing = existing?.team_abbrev === team;

    setBusyWeek(week);
    setError(null);
    try {
      const res = await fetch(`/api/survivor/${competitionId}/plan`, {
        method: clearing ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clearing
            ? { weekNumber: week }
            : { weekNumber: week, teamAbbrev: team, autoSubmit: existing?.auto_submit ?? false }
        ),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Couldn't save");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusyWeek(null);
    }
  }

  async function toggleAutoSubmit(week: number) {
    const entry = planByWeek.get(week);
    if (!entry) return;
    setBusyWeek(week);
    try {
      await fetch(`/api/survivor/${competitionId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekNumber: week,
          teamAbbrev: entry.team_abbrev,
          autoSubmit: !entry.auto_submit,
        }),
      });
      await load();
    } finally {
      setBusyWeek(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400 py-8 text-center">Loading season grid…</p>;
  }
  if (!grid) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error ?? "Couldn't load the grid"}
      </div>
    );
  }

  // Available teams first, then used ones — the spent teams are dead weight at
  // the top of a 32-row grid.
  const teamOrder = Object.keys(grid.teams).sort((a, b) => {
    const aUsed = usedTeams.has(a) ? 1 : 0;
    const bUsed = usedTeams.has(b) ? 1 : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return a.localeCompare(b);
  });

  const futureWeeks = grid.weeks.filter((w) => w >= currentWeek);
  const plannedCount = plan.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{grid.season} season grid</h2>
          <p className="text-xs text-slate-500">
            Click a cell to plan that team for that week. Your plan is private —
            no one else in the pool can see it.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={hideAway}
            onChange={(e) => setHideAway(e.target.checked)}
          />
          Dim away games
        </label>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Planned path summary */}
      {plannedCount > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Your planned path ({plannedCount} week{plannedCount !== 1 ? "s" : ""})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...plan]
              .sort((a, b) => a.week_number - b.week_number)
              .map((p) => (
                <button
                  key={p.week_number}
                  onClick={() => toggleAutoSubmit(p.week_number)}
                  disabled={busyWeek === p.week_number}
                  title={
                    p.auto_submit
                      ? "Auto-submits at lock if you haven't picked. Click to turn off."
                      : "Click to auto-submit this at lock if you haven't picked."
                  }
                  className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                    p.auto_submit
                      ? "bg-rink text-white border-rink"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  Wk {p.week_number}: <span className="font-semibold">{p.team_abbrev}</span>
                  {p.auto_submit && <span className="ml-1">⚡</span>}
                </button>
              ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            ⚡ = auto-submit at lock. Click a chip to toggle.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-500 border-b border-slate-200 min-w-[76px]">
                Team
              </th>
              {futureWeeks.map((w) => (
                <th
                  key={w}
                  className={`px-2 py-2 text-center font-semibold border-b border-slate-200 whitespace-nowrap ${
                    w === currentWeek ? "text-rink" : "text-slate-500"
                  }`}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teamOrder.map((team) => {
              const usedWeek = usedTeams.get(team);
              const isUsed = usedWeek != null;
              const plannedWeek = plannedTeams.get(team);

              return (
                <tr key={team} className={isUsed ? "opacity-40" : ""}>
                  <td
                    className={`sticky left-0 z-10 px-3 py-1.5 border-b border-slate-100 whitespace-nowrap ${
                      isUsed ? "bg-slate-50" : "bg-white"
                    }`}
                    title={grid.teamNames[team]}
                  >
                    <span className="font-bold">{team}</span>
                    {isUsed && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        used W{usedWeek}
                      </span>
                    )}
                  </td>

                  {futureWeeks.map((w) => {
                    const cell = grid.teams[team]?.[w];

                    if (!cell) {
                      return (
                        <td key={w} className="px-2 py-1.5 text-center border-b border-slate-100 text-slate-300">
                          BYE
                        </td>
                      );
                    }

                    const isPlanned = plannedWeek === w;
                    const weekTaken = planByWeek.has(w) && !isPlanned;
                    const disabled = isUsed || busyWeek === w;

                    return (
                      <td key={w} className="px-1 py-1 text-center border-b border-slate-100">
                        <button
                          disabled={disabled}
                          onClick={() => setPlanCell(w, team)}
                          title={`Week ${w}: ${team} ${cell.isHome ? "vs" : "@"} ${cell.opponent}`}
                          className={`w-full rounded px-1.5 py-1 whitespace-nowrap transition-colors ${
                            isPlanned
                              ? "bg-rink text-white font-semibold"
                              : weekTaken
                              ? "text-slate-300"
                              : cell.isHome
                              ? "text-slate-600 hover:bg-slate-100"
                              : hideAway
                              ? "text-slate-300 hover:bg-slate-100"
                              : "text-slate-400 hover:bg-slate-100"
                          } disabled:cursor-not-allowed`}
                        >
                          {cell.isHome ? "" : "@"}{cell.opponent}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        Greyed rows are teams you&apos;ve already used. Away games show a leading @.
        Planning is not a submitted pick — you still confirm each week before lock
        unless you turn on auto-submit.
      </p>
    </div>
  );
}
