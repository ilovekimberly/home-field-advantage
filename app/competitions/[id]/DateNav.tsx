"use client";
import { useRouter } from "next/navigation";

export default function DateNav({
  competitionId,
  activeDate,
  startDate,
  endDate,
  datesWithPicks,
  todayPickable = true,
}: {
  competitionId: string;
  activeDate: string;
  startDate: string;
  endDate: string;
  datesWithPicks: string[];
  todayPickable?: boolean;
}) {
  const router = useRouter();

  function navigate(date: string) {
    router.push(`/competitions/${competitionId}?date=${date}`);
  }

  // All dates in the competition window that either have picks or are today
  // (but only include today if previous results are all in).
  const today = new Date().toISOString().slice(0, 10);
  const baseDates = todayPickable ? [...datesWithPicks, today] : [...datesWithPicks];
  const allDates = Array.from(new Set(baseDates))
    .filter((d) => d >= startDate && d <= endDate)
    .sort();

  const currentIdx = allDates.indexOf(activeDate);
  const prevDate = currentIdx > 0 ? allDates[currentIdx - 1] : null;
  const nextDate = currentIdx < allDates.length - 1 ? allDates[currentIdx + 1] : null;

  // Format date nicely: "Mon Apr 7"
  function fmt(d: string) {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
    });
  }

  const isToday = activeDate === today;

  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <button
        onClick={() => prevDate && navigate(prevDate)}
        disabled={!prevDate}
        className="btn-ghost text-sm disabled:opacity-30 px-3 py-1"
        title={prevDate ? fmt(prevDate) : ""}
      >
        ← {prevDate ? fmt(prevDate) : ""}
      </button>

      <div className="text-center">
        <div className="font-semibold text-rink">{fmt(activeDate)}</div>
        {isToday && <div className="text-xs text-slate-400">Tonight</div>}
      </div>

      <button
        onClick={() => nextDate && navigate(nextDate)}
        disabled={!nextDate}
        className="btn-ghost text-sm disabled:opacity-30 px-3 py-1"
        title={nextDate ? fmt(nextDate) : ""}
      >
        {nextDate ? fmt(nextDate) : ""} →
      </button>
    </div>
  );
}
