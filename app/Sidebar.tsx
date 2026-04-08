"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

// Statuses open by default.
const DEFAULT_OPEN = new Set(["active", "pending", "cancelled"]);

function StatusSection({
  status,
  comps,
  onDelete,
}: {
  status: string;
  comps: SidebarComp[];
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(DEFAULT_OPEN.has(status));
  const [deleting, setDeleting] = useState<string | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Remove this competition?")) return;
    setDeleting(id);
    const res = await fetch(`/api/competitions/${id}`, { method: "DELETE" });
    setDeleting(null);
    if (res.ok) {
      onDelete(id);
      startTransition(() => router.refresh());
    } else {
      alert("Failed to delete — please try again.");
    }
  }

  return (
    <div>
      {/* Section header — clickable to collapse */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-1 mb-1.5 group"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
        <span className="text-xs font-semibold text-slate-500 group-hover:text-slate-700 flex-1 text-left">
          {STATUS_LABEL[status]}
        </span>
        <span className="text-xs text-slate-400">{comps.length}</span>
        <span className="text-slate-300 text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <ul className="space-y-1 mb-1">
          {comps.map((comp) => (
            <li key={comp.id} className="relative group/item">
              <Link
                href={`/competitions/${comp.id}`}
                className="flex flex-col rounded-lg px-2 py-1.5 hover:bg-ice transition-colors pr-7"
              >
                <span className="text-sm font-medium text-slate-800 group-hover/item:text-rink leading-snug truncate">
                  {comp.name}
                </span>
                <span className="text-xs text-slate-400 mt-0.5">
                  {DURATION_LABEL[comp.duration] ?? comp.duration} · {comp.start_date}
                </span>
              </Link>

              {/* Delete button — for cancelled or pending (awaiting opponent) */}
              {(comp.status === "cancelled" || comp.status === "pending") && (
                <button
                  onClick={(e) => handleDelete(e, comp.id)}
                  disabled={deleting === comp.id}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-400 text-xs px-1 py-0.5 rounded"
                  title="Remove"
                >
                  {deleting === comp.id ? "…" : "✕"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Sidebar({ competitions: initialComps }: Props) {
  const [open, setOpen] = useState(true);
  const [comps, setComps] = useState(initialComps);

  function handleDelete(id: string) {
    setComps((prev) => prev.filter((c) => c.id !== id));
  }

  // Group by sport, then by status.
  const bySport: Record<string, Record<string, SidebarComp[]>> = {};
  for (const comp of comps) {
    const sport = comp.sport ?? "NHL";
    if (!bySport[sport]) bySport[sport] = {};
    if (!bySport[sport][comp.status]) bySport[sport][comp.status] = [];
    bySport[sport][comp.status].push(comp);
  }

  return (
    <>
      {/* Tab shown only when sidebar is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-[72px] left-0 z-30 flex items-center gap-1.5 rounded-r-lg border border-l-0 border-slate-200 bg-white px-2 py-2 text-slate-500 hover:text-rink shadow-sm transition-colors"
          aria-label="Open sidebar"
        >
          <span className="text-xs font-medium" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            ▶ Competitions
          </span>
        </button>
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-[65px] left-0 z-20 h-[calc(100vh-65px)] w-64 border-r border-slate-200 bg-white shadow-sm overflow-y-auto transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <span className="font-semibold text-rink text-sm">Your competitions</span>
          <div className="flex items-center gap-2">
            <Link href="/competitions/new" className="text-xs btn-primary py-1 px-2">+ New</Link>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none px-1"
              aria-label="Close sidebar"
              title="Hide sidebar"
            >
              ←
            </button>
          </div>
        </div>

        {comps.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">No competitions yet.</p>
        ) : (
          <div className="p-3 space-y-5">
            {Object.entries(bySport).map(([sport, byStatus]) => (
              <div key={sport}>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">
                  🏒 {sport}
                </div>
                <div className="space-y-3">
                  {STATUS_ORDER.filter((s) => byStatus[s]?.length).map((status) => (
                    <StatusSection
                      key={status}
                      status={status}
                      comps={byStatus[status]}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Spacer to push main content right when sidebar is open */}
      {open && <div className="w-64 shrink-0 hidden md:block" />}
    </>
  );
}
