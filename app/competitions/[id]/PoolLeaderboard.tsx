"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MemberRecord = {
  userId: string;
  name: string;
  wins: number;
  losses: number;
  pushes: number;
  picksMade?: number;
  isMe: boolean;
};

type Props = {
  competitionId: string;
  currentUserId: string;
  initialMembers: MemberRecord[];
  isComplete?: boolean;
};

function winPct(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return "—";
  return (wins / total).toFixed(3).replace(/^0/, "");
}

function RankBadge({ rank, isComplete }: { rank: number; isComplete: boolean }) {
  if (isComplete) {
    if (rank === 1) return <span className="text-lg">🥇</span>;
    if (rank === 2) return <span className="text-lg">🥈</span>;
    if (rank === 3) return <span className="text-lg">🥉</span>;
  }
  return <span className="text-sm font-semibold text-slate-400">#{rank}</span>;
}

export default function PoolLeaderboard({
  competitionId,
  currentUserId,
  initialMembers,
  isComplete = false,
}: Props) {
  const [members, setMembers] = useState<MemberRecord[]>(initialMembers);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    // Re-read all picks and recompute per-member records. Flashes the card
    // only when a W/L actually changed, so routine polls stay quiet.
    async function refreshRecords() {
      const { data: picks } = await supabase
        .from("picks")
        .select("picker_id, result")
        .eq("competition_id", competitionId);

      if (!picks || cancelled) return;

      setMembers((prev) => {
        const next = prev.map((m) => {
          const myPicks = picks.filter((p) => p.picker_id === m.userId);
          return {
            ...m,
            wins:   myPicks.filter((p) => p.result === "win").length,
            losses: myPicks.filter((p) => p.result === "loss").length,
            pushes: myPicks.filter((p) => p.result === "push").length,
            picksMade: myPicks.length,
          };
        });

        const changed = next.some((m, i) =>
          m.wins !== prev[i].wins || m.losses !== prev[i].losses
        );
        if (changed) {
          setFlash(true);
          setTimeout(() => setFlash(false), 1200);
        }
        return next;
      });
    }

    // Ask the server to score any pending picks whose games have gone final,
    // then pull the updated records. Idempotent and safe to call repeatedly.
    async function scoreAndRefresh() {
      try {
        await fetch(`/api/competitions/${competitionId}/score`, { method: "POST" });
      } catch {}
      await refreshRecords();
    }

    // Realtime: fires the moment any pick row changes (scoring, new picks).
    const channel = supabase
      .channel(`pool-picks:${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "picks",
          filter: `competition_id=eq.${competitionId}`,
        },
        () => { refreshRecords(); }
      )
      .subscribe();

    // Poll while the competition is live. Realtime only tells us when a row
    // changes — something still has to trigger the scoring itself, and games
    // go final at unpredictable times.
    scoreAndRefresh();
    const interval = isComplete ? null : setInterval(scoreAndRefresh, 60_000);

    // Catch up immediately when the user returns to the tab.
    function onVisible() {
      if (document.visibilityState === "visible") scoreAndRefresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [competitionId, isComplete]);

  // Sort by wins desc, then losses asc, then name asc
  const sorted = [...members].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.name.localeCompare(b.name);
  });

  // Pre-compute ranks so ties propagate correctly through the whole group.
  // e.g. three players all at 0-1 → all rank 1, not 1/1/2.
  const ranks = sorted.reduce<number[]>((acc, m, i) => {
    if (i === 0) { acc.push(1); return acc; }
    const prev = sorted[i - 1];
    const isTied = prev.wins === m.wins && prev.losses === m.losses;
    acc.push(isTied ? acc[i - 1] : i + 1);
    return acc;
  }, []);

  // Always show the W/L table — a 0-0 record is still a record, and hiding it
  // makes it look like scoring is broken.
  const hasScores = members.some((m) => m.wins > 0 || m.losses > 0);
  const anyPicks = members.some((m) => (m.picksMade ?? 0) > 0);

  return (
    <div className={`card transition-colors duration-500 ${flash ? "bg-green-50" : ""}`}>
      <h2 className="text-lg font-bold mb-3">
        Leaderboard
        {flash && (
          <span className="ml-2 text-xs font-normal text-green-600 animate-pulse">
            · updated
          </span>
        )}
      </h2>

      {!hasScores && !anyPicks ? (
        // No scored picks yet — just show the player list
        <div>
          <ul className="space-y-1">
            {sorted.map((m) => (
              <li
                key={m.userId}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${m.isMe ? "bg-rink/5" : ""}`}
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 bg-slate-200 text-slate-600">
                  {m.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <span className={`flex-1 truncate ${m.isMe ? "font-semibold text-slate-700" : "text-slate-600"}`}>
                  {m.isMe ? "You" : m.name}
                </span>
                <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                  {m.picksMade ?? 0} pick{(m.picksMade ?? 0) !== 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400 mt-3 text-center">Records appear once games are final</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2 w-8">#</th>
              <th className="pb-2">Player</th>
              <th className="pb-2 text-right">W</th>
              <th className="pb-2 text-right">L</th>
              <th className="pb-2 text-right">Pct</th>
              <th className="pb-2 text-right">Picks</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => {
              const rank = ranks[i];

              return (
                <tr
                  key={m.userId}
                  className={`border-b last:border-0 ${m.isMe ? "bg-rink/5" : ""}`}
                >
                  <td className="py-2 pr-2">
                    <RankBadge rank={rank} isComplete={isComplete} />
                  </td>
                  <td className="py-2 font-medium max-w-0 w-full">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{m.name}</span>
                      {m.isMe && (
                        <span className="shrink-0 text-[10px] font-semibold text-rink bg-rink/10 px-1.5 py-0.5 rounded-full">
                          you
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums whitespace-nowrap">{m.wins}</td>
                  <td className="py-2 text-right tabular-nums whitespace-nowrap">{m.losses}</td>
                  <td className="py-2 text-right tabular-nums text-slate-500 whitespace-nowrap">
                    {winPct(m.wins, m.losses)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-400 whitespace-nowrap">
                    {m.picksMade ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {anyPicks && !hasScores && (
        <p className="text-xs text-slate-400 mt-3 text-center">
          W/L updates as games go final
        </p>
      )}
    </div>
  );
}
