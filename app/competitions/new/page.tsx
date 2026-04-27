"use client";
// v2
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SportPhase } from "@/app/api/sport-phase/route";

type Sport = "NHL" | "MLB" | "EPL";
type Duration = "daily" | "weekly" | "season" | "playoff";
type DraftStyle = "standard" | "balanced";

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

// Static fallback end dates (used for EPL and if API call fails).
function staticSeasonEnd(sport: Sport, start: string) {
  const year = new Date(start).getUTCFullYear();
  if (sport === "NHL") return `${year}-04-20`;
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
  const [draftStyle, setDraftStyle] = useState<DraftStyle>("standard");
  const [enableOverUnder, setEnableOverUnder] = useState(false);
  const [enableSpread, setEnableSpread] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase detection for NHL and MLB.
  const [phaseInfo, setPhaseInfo] = useState<SportPhase | null>(null);
  const [phaseLoading, setPhaseLoading] = useState(false);

  useEffect(() => {
    if (sport === "EPL") {
      setPhaseInfo(null);
      return;
    }
    setPhaseLoading(true);
    setPhaseInfo(null);
    fetch(`/api/sport-phase?sport=${sport}`)
      .then((r) => r.json())
      .then((data: SportPhase) => setPhaseInfo(data))
      .catch(() => setPhaseInfo(null))
      .finally(() => setPhaseLoading(false));
  }, [sport]);

  // When we detect playoffs, the "season" duration now means playoffs —
  // make sure the default still works or auto-adjust if user had "season" selected.
  // (No forced reset; the label just changes.)

  function seasonEnd(): string {
    if (sport === "EPL") return staticSeasonEnd("EPL", startDate);
    if (phaseInfo) {
      return phaseInfo.phase === "playoffs"
        ? phaseInfo.playoffEndDate
        : phaseInfo.seasonEndDate;
    }
    return staticSeasonEnd(sport, startDate);
  }

  function endDateFor(start: string, dur: Duration) {
    if (dur === "daily") return addDays(start, sport === "EPL" ? 3 : 0);
    if (dur === "weekly") return addDays(start, sport === "EPL" ? 27 : 6);
    return seasonEnd();
  }

  // Label for the "season" duration option.
  const seasonOptionLabel =
    sport === "EPL"
      ? "Full season (Aug – May)"
      : phaseLoading
      ? "Full season (detecting…)"
      : phaseInfo?.label ?? "Full regular season";

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
    // Store "playoff" when the sport is currently in playoffs and user picked "season".
    const storedDuration: Duration =
      duration === "season" && phaseInfo?.phase === "playoffs" ? "playoff" : duration;

    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: name || namePlaceholder,
        sport,
        duration: storedDuration,
        draft_style: draftStyle,
        enable_over_under: (sport === "NHL" || sport === "MLB") ? enableOverUnder : false,
        enable_spread: (sport === "NHL" || sport === "MLB") ? enableSpread : false,
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
    router.refresh();
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

          {/* Phase badge for NHL / MLB */}
          {(sport === "NHL" || sport === "MLB") && (
            <div className="mt-2 h-5">
              {phaseLoading && (
                <span className="text-xs text-slate-400">Detecting current phase…</span>
              )}
              {!phaseLoading && phaseInfo && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                    phaseInfo.phase === "playoffs"
                      ? "bg-amber-100 text-amber-700"
                      : phaseInfo.phase === "offseason"
                      ? "bg-slate-100 text-slate-500"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {phaseInfo.phase === "playoffs" && "🏆 Playoffs"}
                  {phaseInfo.phase === "season" && "🗓 Regular season"}
                  {phaseInfo.phase === "offseason" && "💤 Off-season"}
                </span>
              )}
            </div>
          )}
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
            {sport === "EPL" ? (
              <>
                <option value="daily">Single gameweek</option>
                <option value="weekly">4 gameweeks</option>
                <option value="season">Full season (Aug – May)</option>
              </>
            ) : (
              <>
                <option value="daily">Single day</option>
                <option value="weekly">One week</option>
                <option value="season">{seasonOptionLabel}</option>
              </>
            )}
          </select>
          {(duration === "season" || duration === "playoff") && (
            <span className="text-xs text-slate-500 mt-1 block">
              Ends {seasonEnd()}
            </span>
          )}
        </label>

        {/* Draft style */}
        <div>
          <span className="block text-sm font-medium mb-2">Draft style</span>
          <div className="grid grid-cols-2 gap-2">
            {([
              {
                value: "standard" as DraftStyle,
                label: "Standard snake",
                pattern: "A · BB · AA · BB · A",
                desc: "Classic snake — pair at the start, alternate through, pair at the end.",
              },
              {
                value: "balanced" as DraftStyle,
                label: "Balanced snake",
                pattern: "A · BB · AA · BB · AA · B",
                desc: "Single first pick, then strict pairs all the way through.",
              },
            ] as const).map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setDraftStyle(s.value)}
                className={`flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-colors ${
                  draftStyle === s.value
                    ? "border-rink bg-ice"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className={`text-sm font-semibold ${draftStyle === s.value ? "text-rink" : "text-slate-700"}`}>
                  {s.label}
                </span>
                <span className="text-xs font-mono text-slate-500">{s.pattern}</span>
                <span className="text-xs text-slate-400 leading-snug">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Pick type toggles — NHL + MLB */}
        {(sport === "NHL" || sport === "MLB") && (
          <div>
            <span className="block text-sm font-medium mb-2">Pick types</span>
            <div className="space-y-2">
              {/* Over/Under toggle */}
              <button
                type="button"
                onClick={() => setEnableOverUnder((v) => !v)}
                className={`w-full flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                  enableOverUnder ? "border-rink bg-ice" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                  enableOverUnder ? "bg-rink border-rink" : "border-slate-300"
                }`}>
                  {enableOverUnder && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
                <div>
                  <span className={`text-sm font-semibold ${enableOverUnder ? "text-rink" : "text-slate-700"}`}>
                    Enable over/under picks
                  </span>
                  <p className="text-xs text-slate-400 leading-snug mt-0.5">
                    Use a pick slot on the total {sport === "MLB" ? "runs" : "goals"} (over/under) instead of a winner.
                    Lines and odds are pulled from live markets and frozen before {sport === "MLB" ? "first pitch" : "puck drop"}.
                    Exact total = loss.
                  </p>
                </div>
              </button>

              {/* Spread toggle */}
              <button
                type="button"
                onClick={() => setEnableSpread((v) => !v)}
                className={`w-full flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                  enableSpread ? "border-rink bg-ice" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                  enableSpread ? "bg-rink border-rink" : "border-slate-300"
                }`}>
                  {enableSpread && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
                <div>
                  <span className={`text-sm font-semibold ${enableSpread ? "text-rink" : "text-slate-700"}`}>
                    Enable spread picks
                  </span>
                  <p className="text-xs text-slate-400 leading-snug mt-0.5">
                    Use a pick slot on the {sport === "MLB" ? "run line" : "puck line"} (spread) instead of a winner.
                    Moneyline odds appear next to all team buttons for context.
                    Push = loss.
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

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
