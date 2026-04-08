"use client";

import { useState } from "react";
import Link from "next/link";

type SidebarComp = {
  id: string;
  name: string;
  sport: string;
  duration: string;
  status: string;
  start_date: string;
  opponent_id: string | null;
};

type Props = {
  competitions: SidebarComp[];
};

const STATUS_ORDER = ["active", "pending", "complete", "cancelled"];

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Awaiting Opponent",
  complete: "Completed",
  cancelled: "Cancelled",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-400",
  pending: "bg-yellow-400",
  complete: "bg-slate-400",
  cancelled: "bg-slate-300",
};

const DURATION_LABEL: Record<string, string> = {
  daily: "Single day",
  weekly: "1 week",
  season: "Full season",
};

export default function Sidebar({ competitions }: Props) {
  const [open, setOpen] = useState(true);

  // Group by sport, then by status.
  const bySport: Record<string, Record<string, SidebarComp[]>> = {};
  for (const comp of competitions) {
    const sport = comp.sport ?? "NHL";
    if (!bySport[sport]) bySport[sport] = {};
    if (!bySport[sport][comp.status]) bySport[sport][comp.status] = [];
    bySport[sport][comp.status].push(comp);
  }

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed top-[72px] left-0 z-30 flex items-center gap-1.5 rounded-r-lg border border-l-0 border-slate-200 bg-white px-2 py-2 text-slate-500 hover:text-rink shadow-sm transition-colors"
        aria-label="Toggle sidebar"
      >
        <span className="text-xs font-medium" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {open ? "◀ Hide" : "▶ Competitions"}
        </span>
      </button>

      {/* Sidebar panel */}
      <aside
        className={`fixed top-[65px] left-0 z-20 h-[calc(100vh-65px)] w-64 border-r border-slate-200 bg-white shadow-sm overflow-y-auto transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="font-semibold text-rink text-sm">Your competitions</span>
          <Link href="/competitions/new" className="text-xs btn-primary py-1 px-2">+ New</Link>
        </div>

        {competitions.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">No competitions yet.</p>
        ) : (
          <div className="p-3 space-y-5">
            {Object.entries(bySport).map(([sport, byStatus]) => (
              <div key={sport}>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
                  🏒 {sport}
                </div>

                <div className="space-y-4">
                  {STATUS_ORDER.filter((s) => byStatus[s]?.length).map((status) => (
                    <div key={status}>
                      <div className="flex items-center gap-1.5 mb-1.5 px-1">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
                        <span className="text-xs font-semibold text-slate-500">
                          {STATUS_LABEL[status]}
                        </span>
                        <span className="ml-auto text-xs text-slate-400">
                          {byStatus[status].length}
                        </span>
                      </div>

                      <ul className="space-y-1">
                        {byStatus[status].map((comp) => (
                          <li key={comp.id}>
                            <Link
                              href={`/competitions/${comp.id}`}
                              className="flex flex-col rounded-lg px-2 py-1.5 hover:bg-ice transition-colors group"
                            >
                              <span className="text-sm font-medium text-slate-800 group-hover:text-rink leading-snug truncate">
                                {comp.name}
                              </span>
                              <span className="text-xs text-slate-400 mt-0.5">
                                {DURATION_LABEL[comp.duration] ?? comp.duration} · {comp.start_date}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Push main content over when sidebar is open */}
      {open && <div className="w-64 shrink-0 hidden md:block" />}
    </>
  );
}
