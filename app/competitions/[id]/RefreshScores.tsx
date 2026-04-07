"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefreshScores({ cronSecret }: { cronSecret: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/cron/score?secret=${encodeURIComponent(cronSecret)}`);
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setStatus(
        data.updated > 0
          ? `${data.updated} pick${data.updated !== 1 ? "s" : ""} scored ✓`
          : "No new results yet — games may still be in progress."
      );
      router.refresh();
    } else {
      setStatus("Failed to refresh — check Vercel logs.");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={refresh}
        disabled={busy}
        className="btn-ghost text-sm disabled:opacity-40"
      >
        {busy ? "Checking scores…" : "↻ Refresh scores"}
      </button>
      {status && <span className="text-sm text-slate-600">{status}</span>}
    </div>
  );
}
