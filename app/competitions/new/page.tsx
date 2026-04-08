"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Sport = "NHL" | "MLB" | "EPL";
type Duration = "daily" | "weekly" | "season";

const SPORTS: { value: Sport; label: string; emoji: string }[] = [
  { value: "NHL", label: "NHL Hockey", emoji: "🏒" },
  { value: "MLB", label: "MLB Baseball", emoji: "⚾" },
  { value: "EPL", label: "Premier League", emoji: "⚽" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function seasonEndFor(sport: Sport, start: string) {
  const year = new Date(start).getUTCFullYear();
  if (sport === "NHL") return `${year}-04-15`;
  if (sport === "MLB") return `${year}-09-30`;
  if (sport === "EPL") return `${year + 1}-05-20`;
  return addDays(start, 180);
}

export default function NewCompetitionPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [sport, setSport] = useState<Sport>("NHL");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState<Duration>("daily");
  const [startDate, setStartDate] = useState(todayISO());
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function endDateFor(start: string, dur: Duration) {
    if (dur === "daily") return start;
    if (dur === "weekly") return addDays(start, 6);
    return seasonEndFor(sport, start);
  }

  // Auto-suggest a name when sport or duration changes.
  const namePlaceholder =
    sport === "NHL" ? "Friday Night Faceoff" :
    sport === "MLB" ? "Summer Slugfest" :
    "Premier Picks";

  async function createCompetition(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("You must be signed in."); setBusy(false); return; }
    const end = endDateFor(startDate, duration);
    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: name || namePlaceholder,
        sport,
        duration,
        start_date: startDate,
        end_date: end,
        creator_id: user.id,
      })
      .select()
      .single();
    if (error) { setError(error.message); setBusy(false); return; }
    if (inviteEmail) {
      await fetch("/api/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competitionId: data.id, toEmail: inviteEmail }),
      }).catch(() => {});
    }
    router.push(`/competitions/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-xl card">
      <h1 className="text-2xl font-bold mb-6">New competition</h1>
      <form onSubmit={createCompetition} className="space-y-5">

        {/* Sport selector */}
        <div>
          <span className="block text-sm font-medium mb-2">Sport</span>
          <div className="grid grid-cols-3 gap-2">
            {SPORTS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSport(s.value)}
                className={`flex flex-col items-center gap-1 rounded-xl border-2 py-3 text-sm font-medium transition-colors ${
                  sport === s.value
                    ? "border-rink bg-ice text-rink"
                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                }`}
              >
                <span className="text-2xl">{s.emoji}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <label className="block">
          <span className="text-sm font-medium">Competition name</span>
          <input
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={namePlaceholder}
          />
        </label>

        {/* Duration */}
        <label className="block">
          <span className="text-sm font-medium">Length</span>
          <select
            className="input mt-1"
            value={duration}
            onChange={(e) => setDuration(e.target.value as Duration)}
          >
            <option value="daily">Single day</option>
            <option value="weekly">One week</option>
            <option value="season">Full regular season</option>
          </select>
        </label>

        {/* Start date */}
        <label className="block">
          <span className="text-sm font-medium">Start date</span>
          <input
            type="date"
            className="input mt-1"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          {duration === "season" && (
            <span className="text-xs text-slate-500 mt-1 block">
              Season ends {seasonEndFor(sport, startDate)}
            </span>
          )}
        </label>

        {/* Invite */}
        <label className="block">
          <span className="text-sm font-medium">Invite a friend (optional)</span>
          <input
            type="email"
            className="input mt-1"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="friend@email.com"
          />
          <span className="text-xs text-slate-500 mt-1 block">
            You can also share an invite link from the competition page after creating.
          </span>
        </label>

        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy
            ? inviteEmail ? "Creating & sending invite…" : "Creating…"
            : "Create competition"}
        </button>
      </form>
    </div>
  );
}
