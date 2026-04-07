"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export default function NewCompetitionPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [name, setName] = useState("Friday Night Faceoff");
  const [duration, setDuration] = useState<"daily" | "weekly" | "season">("daily");
  const [startDate, setStartDate] = useState(todayISO());
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function endDateFor(start: string, dur: "daily"|"weekly"|"season") {
    if (dur === "daily") return start;
    if (dur === "weekly") return addDays(start, 6);
    // NHL regular season typically ends mid-April
    return `${new Date(start).getUTCFullYear() + (new Date(start).getUTCMonth() >= 9 ? 1 : 0)}-04-15`;
  }

  async function createCompetition(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("You must be signed in."); setBusy(false); return; }
    const end = endDateFor(startDate, duration);
    const { data, error } = await supabase
      .from("competitions")
      .insert({ name, duration, start_date: startDate, end_date: end, creator_id: user.id })
      .select()
      .single();
    if (error) { setError(error.message); setBusy(false); return; }
    // Send invite email if an address was provided.
    if (inviteEmail) {
      const inviteRes = await fetch("/api/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competitionId: data.id, toEmail: inviteEmail }),
      });
      if (!inviteRes.ok) {
        // Don't block navigation — email failure shouldn't stop the user.
        console.error("Invite email failed:", await inviteRes.json().catch(() => ({})));
      }
    }
    router.push(`/competitions/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-xl card">
      <h1 className="text-2xl font-bold mb-4">New competition</h1>
      <form onSubmit={createCompetition} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Length</span>
          <select className="input mt-1" value={duration} onChange={(e) => setDuration(e.target.value as any)}>
            <option value="daily">Single day</option>
            <option value="weekly">One week</option>
            <option value="season">Full regular season</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Start date</span>
          <input type="date" className="input mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Invite a friend (email, optional)</span>
          <input type="email" className="input mt-1" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <span className="text-xs text-slate-500">You can also share an invite link from the competition page after it's created.</span>
        </label>

        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? (inviteEmail ? "Creating & sending invite…" : "Creating…") : "Create competition"}
        </button>
      </form>
    </div>
  );
}
