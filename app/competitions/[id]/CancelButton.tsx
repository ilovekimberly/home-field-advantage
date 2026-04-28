"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelButton({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}`, { method: "PATCH" });
    if (res.ok) {
      router.push("/");
    } else {
      const data = await res.json();
      alert(data.error ?? "Could not cancel competition.");
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
        <button
          onClick={() => setConfirming(true)}
          className="text-sm text-slate-400 hover:text-red-500 transition-colors"
        >
          Cancel competition
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="text-sm text-slate-600 mb-3">
        Are you sure you want to cancel this competition? This can't be undone.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="btn-ghost text-sm py-1.5 px-4"
        >
          Keep it
        </button>
        <button
          onClick={handleCancel}
          disabled={busy}
          className="text-sm px-4 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
        >
          {busy ? "Cancelling…" : "Yes, cancel"}
        </button>
      </div>
    </div>
  );
}
