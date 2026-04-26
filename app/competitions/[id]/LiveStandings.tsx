"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Record = { wins: number; losses: number; pushes: number };

type Props = {
  competitionId: string;
  playerAId: string;
  playerBId: string;
  nameA: string;
  nameB: string;
  initialA: Record;
  initialB: Record;
};

export default function LiveStandings({
  competitionId, playerAId, playerBId, nameA, nameB, initialA, initialB,
}: Props) {
  const [recordA, setRecordA] = useState(initialA);
  const [recordB, setRecordB] = useState(initialB);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    // Subscribe to any pick result change for this competition.
    const channel = supabase
      .channel(`picks:${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "picks",
          filter: `competition_id=eq.${competitionId}`,
        },
        async () => {
          // Re-fetch all picks for this competition and recompute standings.
          const { data: picks } = await supabase
            .from("picks")
            .select("picker_id, result")
            .eq("competition_id", competitionId);

          if (!picks) return;

          const a = { wins: 0, losses: 0, pushes: 0 };
          const b = { wins: 0, losses: 0, pushes: 0 };
          for (const p of picks) {
            const rec = p.picker_id === playerAId ? a : b;
            if (p.result === "win")   rec.wins++;
            if (p.result === "loss")  rec.losses++;
            if (p.result === "push")  rec.pushes++;
          }

          setRecordA(a);
          setRecordB(b);

          // Brief flash to signal an update landed.
          setFlash(true);
          setTimeout(() => setFlash(false), 1200);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [competitionId, playerAId, playerBId]);

  return (
    <div className={`card transition-colors duration-500 ${flash ? "bg-green-50" : ""}`}>
      <h2 className="text-lg font-bold mb-3">
        Overall standings
        {flash && (
          <span className="ml-2 text-xs font-normal text-green-600 animate-pulse">
            · updated
          </span>
        )}
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b">
            <th className="pb-2">Player</th>
            <th className="pb-2">W</th>
            <th className="pb-2">L</th>
            <th className="pb-2">Pct</th>
          </tr>
        </thead>
        <tbody>
          {[
            { name: nameA, ...recordA },
            { name: nameB, ...recordB },
          ].map((row) => {
            const total = row.wins + row.losses;
            const pct = total === 0 ? "—" : (row.wins / total).toFixed(3).replace(/^0/, "");
            return (
              <tr key={row.name} className="border-b last:border-0">
                <td className="py-2 font-medium">{row.name}</td>
                <td className="py-2">{row.wins}</td>
                <td className="py-2">{row.losses}</td>
                <td className="py-2 text-slate-500">{pct}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
