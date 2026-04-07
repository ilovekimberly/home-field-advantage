"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeferBanner({
  competitionId,
  gameDate,
  opponentName,
}: {
  competitionId: string;
  gameDate: string;
  opponentName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(deferred: boolean) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/competitions/${competitionId}/defer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameDate, deferred }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border-2 border-rink bg-ice p-5 mb-4">
      <h3 className="font-bold text-rink text-base mb-1">You have pick priority tonight</h3>
      <p className="text-sm text-slate-600 mb-4">
        Your record gives you first choice. You can either take pick&nbsp;#1 now,
        or <strong>defer</strong> and take picks&nbsp;#2&nbsp;&amp;&nbsp;#3 back-to-back —
        giving {opponentName} pick&nbsp;#1.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          disabled={busy}
          onClick={() => choose(false)}
          className="btn-primary disabled:opacity-40 flex flex-col items-center py-3 rounded-lg"
        >
          <span className="text-lg font-bold">Pick #1</span>
          <span className="text-xs opacity-80 mt-0.5">Pick first, straight up</span>
        </button>

        <button
          disabled={busy}
          onClick={() => choose(true)}
          className="btn-ghost disabled:opacity-40 flex flex-col items-center py-3 rounded-lg"
        >
          <span className="text-lg font-bold">Defer → #2 &amp; #3</span>
          <span className="text-xs text-slate-500 mt-0.5">Let {opponentName} go first</span>
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
    </div>
  );
}
