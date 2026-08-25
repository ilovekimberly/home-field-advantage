"use client";
import { useRouter } from "next/navigation";

export default function DateNav({
  competitionId,
  activeDate,
  startDate,
  endDate,
  datesWithPicks,
  todayPickable = true,
  sport = "NHL",
  weekLabel,
  weekLabels = {},
}: {
  competitionId: string;
  activeDate: string;
  startDate: string;
  endDate: string;
  datesWithPicks: string[];
  todayPickable?: boolean;
  sport?: string;
  weekLabel?: string;
  /** pick-date → official week label, e.g. { "2026-08-28": "Matchweek 2" } */
  weekLabels?: Record<string, string>;
}) {
  const router = useRouter();
  // NFL weeks and EPL matchweeks both cover a multi-day slate, so they get
  // week-style labels instead of a single calendar date.
  const isWeekly = sport === "NFL" || sport === "EPL";
  const weekNoun = sport === "EPL" ? "Matchweek" : "Wk";

  function navigate(date: string) {
    router.push(`/competitions/${competitionId}?date=${date}`);
  }

  // All dates in the competition window that either have picks or are today
  // (but only include today if previous results are all in).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const baseDates = todayPickable ? [...datesWithPicks, today] : [...datesWithPicks];
  const allDates = Array.from(new Set(baseDates))
    .filter((d) => d >= startDate && d <= endDate)
    .sort();

  const currentIdx = allDates.indexOf(activeDate);
  const prevDate = currentIdx > 0 ? allDates[currentIdx - 1] : null;
  const nextDate = currentIdx < allDates.length - 1 ? allDates[currentIdx + 1] : null;

  // Week-based sports show "Wk of Aug 25" / "Matchweek of Aug 25" rather than
  // a bare calendar date, which reads as a single day's slate.
  function fmt(d: string) {
    const dt = new Date(d + "T12:00:00Z");
    if (isWeekly) {
      const short = dt.toLocaleDateString("en-US", {
        month: "short", day: "numeric", timeZone: "UTC",
      });
      return `${weekNoun} of ${short}`;
    }
    return dt.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
    });
  }

  // Prefer the real week label ("Matchweek 2") over a date-derived one.
  function label(d: string) {
    return weekLabels[d] ?? fmt(d);
  }

  const isCurrentWeek = isWeekly
    ? activeDate === today || Math.abs(new Date(activeDate).getTime() - new Date(today).getTime()) < 7 * 86400000
    : activeDate === today;

  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <button
        onClick={() => prevDate && navigate(prevDate)}
        disabled={!prevDate}
        className="btn-ghost text-sm disabled:opacity-30 px-3 py-1"
        title={prevDate ? label(prevDate) : ""}
      >
        ← {prevDate ? label(prevDate) : ""}
      </button>

      <div className="text-center">
        {/* weekLabel is the official "Preseason Week 2" / "Matchweek 1" string
            resolved from the schedule API — use it whenever we have one. */}
        <div className="font-semibold text-rink">{weekLabel || label(activeDate)}</div>
        {isCurrentWeek && (
          <div className="text-xs text-slate-400">{isWeekly ? "This week" : "Tonight"}</div>
        )}
      </div>

      <button
        onClick={() => nextDate && navigate(nextDate)}
        disabled={!nextDate}
        className="btn-ghost text-sm disabled:opacity-30 px-3 py-1"
        title={nextDate ? label(nextDate) : ""}
      >
        {nextDate ? label(nextDate) : ""} →
      </button>
    </div>
  );
}
