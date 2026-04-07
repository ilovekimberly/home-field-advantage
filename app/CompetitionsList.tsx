"use client";

import Link from "next/link";
import { useState } from "react";

type BadgeStyle = { label: string; color: string };

function getStatusBadge(
  comp: any,
  myId: string,
  myWins: number, myLosses: number,
  theirWins: number, theirLosses: number,
  isMyTurnTonight: boolean,
): BadgeStyle {
  if (comp.status === "cancelled") {
    return { label: "Cancelled", color: "bg-slate-100 text-slate-500" };
  }
  if (comp.status === "pending" && !comp.opponent_id) {
    return { label: "Awaiting opponent", color: "bg-yellow-100 text-yellow-800" };
  }
  if (comp.status === "complete") {
    if (myWins > theirWins) return { label: "You won!", color: "bg-green-100 text-green-800" };
    if (myWins < theirWins) return { label: "You lost", color: "bg-red-100 text-red-700" };
    return { label: "Tied", color: "bg-slate-100 text-slate-600" };
  }
  if (isMyTurnTonight) {
    return { label: "Your turn to pick", color: "bg-rink text-white" };
  }
  return { label: "Waiting on opponent", color: "bg-slate-100 text-slate-600" };
}

function CompetitionCard({ c, userId }: { c: any; userId: string }) {
  const badge = getStatusBadge(
    c, userId, c.myWins, c.myLosses, c.theirWins, c.theirLosses, c.isMyTurnTonight,
  );
  const durationLabel =
    c.duration === "daily" ? "Single day" :
    c.duration === "weekly" ? "1 week" : "Full season";

  return (
    <li className="card hover:shadow-md transition-shadow">
      <Link href={`/competitions/${c.id}`} className="block">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="font-semibold text-rink hover:underline leading-tight">{c.name}</span>
          <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${badge.color}`}>
            {badge.label}
          </span>
        </div>

        <div className="text-xs text-slate-500 mb-3">
          🏒 NHL · {durationLabel} · {c.start_date}
          {c.duration !== "daily" && ` → ${c.end_date}`}
        </div>

        {c.opponentName ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="text-center">
                <div className="text-xs text-slate-500 mb-0.5">You</div>
                <div className="font-bold text-lg leading-none">{c.myWins}–{c.myLosses}</div>
              </div>
              <div className="text-xs text-slate-400 font-medium">Overall</div>
              <div className="text-center">
                <div className="text-xs text-slate-500 mb-0.5">{c.opponentName}</div>
                <div className="font-bold text-lg leading-none">{c.theirWins}–{c.theirLosses}</div>
              </div>
            </div>
            {c.hasPicksTonight && c.duration !== "daily" && c.status !== "complete" && (
              <div className="flex items-center justify-between rounded-lg bg-ice px-3 py-1.5 text-sm">
                <div className="font-semibold tabular-nums">{c.myWinsTonight}–{c.myLossesTonight}</div>
                <div className="text-xs text-rink font-medium">Tonight</div>
                <div className="font-semibold tabular-nums">{c.theirWinsTonight}–{c.theirLossesTonight}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic">
            No opponent yet — share your invite link
          </div>
        )}
      </Link>
    </li>
  );
}

export function CompetitionsList({ enriched, userId }: { enriched: any[]; userId: string }) {
  const active = enriched.filter((c) => c.status !== "complete" && c.status !== "cancelled");
  const past = enriched.filter((c) => c.status === "complete" || c.status === "cancelled");
  const [pastOpen, setPastOpen] = useState(false);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">Your competitions</h2>
          <Link href="/competitions/new" className="btn-primary">+ New</Link>
        </div>
        {active.length === 0 ? (
          <p className="text-slate-500">No active competitions. Create one to get started.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((c) => <CompetitionCard key={c.id} c={c} userId={userId} />)}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <button
            onClick={() => setPastOpen((o) => !o)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-700 transition-colors w-full text-left mb-3"
          >
            <span className="text-xl font-bold">Past competitions</span>
            <span className="text-sm font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {past.length}
            </span>
            <span className="ml-auto text-slate-400 text-lg">
              {pastOpen ? "▲" : "▼"}
            </span>
          </button>

          {pastOpen && (
            <ul className="grid gap-3 md:grid-cols-2">
              {past.map((c) => <CompetitionCard key={c.id} c={c} userId={userId} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
