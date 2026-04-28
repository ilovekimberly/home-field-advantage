"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Auto-polls the score API every 60 seconds while games are pending.
// When results come in, the router refresh updates standings automatically.
export default function RefreshScores({ cronSecret }: { cronSecret: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh(silent = false) {
    if (!silent) setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/cron/score?secret=${encodeURIComponent(cronSecret)}`);
      const data = await res.json().catch(() => ({}));
      setLastChecked(new Date());
      if (res.ok) {
        if (data.updated > 0) {
          setStatus(`${data.updated} pick${data.updated !== 1 ? "s" : ""} scored ✓`);
          router.refresh();
        } else if (!silent) {
          setStatus("No new results yet — games may still be in progress.");
        }
      } else if (!silent) {
        setStatus("Failed to refresh — check Vercel logs.");
      }
    } catch {
      if (!silent) setStatus("Network error — try again.");
    }
    if (!silent) setBusy(false);
  }

  // Auto-poll every 60 seconds while this component is mounted (i.e. while
  // there are pending picks). Clears when component unmounts.
  useEffect(() => {
    intervalRef.current = setInterval(() => refresh(true), 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cronSecret]);

  const timeLabel = lastChecked
    ? lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => refresh(false)}
        disabled={busy}
        className="btn-ghost text-sm disabled:opacity-40"
      >
        {busy ? "Checking scores…" : "↻ Refresh scores"}
      </button>
      {status && <span className="text-sm text-slate-600">{status}</span>}
      {!status && timeLabel && (
        <span className="text-xs text-slate-400">checked {timeLabel}</span>
      )}
    </div>
  );
}
