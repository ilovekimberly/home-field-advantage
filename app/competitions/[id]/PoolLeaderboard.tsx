"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MemberRecord = {
  userId: string;
  name: string;
  wins: number;
  losses: number;
  pushes: number;
  isMe: boolean;
};

type Props = {
  competitionId: string;
  currentUserId: string;
  initialMembers: MemberRecord[];
};

function winPct(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return "—";
  return (wins / total).toFixed(3).replace(/^0/, "");
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="text-sm font-semibold text-slate-400">#{rank}</span>;
}

export default function PoolLeaderboard({
  competitionId,
  currentUserId,
  initialMembers,
}: Props) {
  const [members, setMembers] = useState<MemberRecord[]>(initialMembers);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel(`pool-picks:${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "picks",
          filter: `competition_id=eq.${competitionId}`,
        },
        async () => {
          // Re-fetch all picks and recompute per-member records.
          const { data: picks } = await supabase
            .from("picks")
            .select("picker_id, result")
            .eq("competition_id", competitionId);

          if (!picks) return;

          setMembers((prev) =>
            prev.map((m) => {
              const myPicks = picks.filter((p) => p.picker_id === m.userId);
              return {
                ...m,
                wins:   myPicks.filter((p) => p.result === "win").length,
                losses: myPicks.filter((p) => p.result === "loss").length,
                pushes: myPicks.filter((p) => p.result === "push").length,
              };
            })
          );

          setFlash(true);
          setTimeout(() => setFlash(false), 1200);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [competitionId]);

  // Sort by wins desc, then losses asc, then name asc
  const sorted = [...members].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.name.localeCompare(b.name);
  });

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

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b">
            <th className="pb-2 w-8">#</th>
            <th className="pb-2">Player</th>
            <th className="pb-2 text-right">W</th>
            <th className="pb-2 text-right">L</th>
            <th className="pb-2 text-right">Pct</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => {
            // Tie handling: same rank if same wins/losses as the previous entry
            const prev = sorted[i - 1];
            const rank = prev && prev.wins === m.wins && prev.losses === m.losses ? i : i + 1;

            return (
              <tr
                key={m.userId}
                className={`border-b last:border-0 ${m.isMe ? "bg-rink/5" : ""}`}
              >
                <td className="py-2 pr-2">
                  <RankBadge rank={rank} />
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
