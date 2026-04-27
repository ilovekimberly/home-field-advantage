// Server component — receives pre-computed data from the competition page.

type NightResult = {
  date: string;
  myWins: number;
  myLosses: number;
  theirWins: number;
  theirLosses: number;
  myName: string;
  theirName: string;
};

export default function NightlyRecap({ night }: { night: NightResult }) {
  const { date, myWins, myLosses, theirWins, theirLosses, myName, theirName } = night;

  const youWonNight = myWins > theirWins;
  const theyWonNight = theirWins > myWins;
  const tied = myWins === theirWins;

  const iPerfect    = myWins > 0 && myLosses === 0;
  const theyPerfect = theirWins > 0 && theirLosses === 0;

  const formattedDate = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
  });

  let headline: string;
  let bg: string;
  if (tied) {
    const tiedRecord = (myLosses === theirLosses)
      ? `${myWins}–${myLosses} each`
      : `${myWins}–${myLosses} · ${theirWins}–${theirLosses}`;
    headline = `${formattedDate} ended tied — ${tiedRecord}`;
    bg = "bg-slate-50 border-slate-200";
  } else if (youWonNight) {
    headline = `You won ${formattedDate} ${myWins}–${theirWins}`;
    bg = "bg-green-50 border-green-200";
  } else {
    headline = `${theirName} won ${formattedDate} ${theirWins}–${myWins}`;
    bg = "bg-red-50 border-red-200";
  }

  const emoji = iPerfect ? "🔥" : theyPerfect ? "😤" : youWonNight ? "🏆" : theyWonNight ? "😤" : "🤝";

  return (
    <div className={`rounded-lg border px-4 py-3 mb-4 ${bg}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{headline}</p>
          {(iPerfect || theyPerfect) && (
            <p className="text-xs font-semibold mt-0.5 text-amber-600">
              🔥 {iPerfect ? "You" : theirName} went perfect — swept all picks!
            </p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">
            {myName}: {myWins}W {myLosses}L &nbsp;·&nbsp;
            {theirName}: {theirWins}W {theirLosses}L
          </p>
        </div>
        <span className="text-2xl shrink-0">{emoji}</span>
      </div>
    </div>
  );
}
