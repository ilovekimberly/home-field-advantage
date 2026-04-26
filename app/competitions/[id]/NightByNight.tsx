// Server component — per-date results breakdown for weekly/season competitions.
import Link from "next/link";

export type NightEntry = {
  date: string;
  myWins: number;
  myLosses: number;
  theirWins: number;
  theirLosses: number;
  /** True if any picks on this date are still pending/unscored */
  hasPending: boolean;
};

type Props = {
  competitionId: string;
  nights: NightEntry[];
  myName: string;
  theirName: string;
  activeDate: string;
};

export default function NightByNight({ competitionId, nights, myName, theirName, activeDate }: Props) {
  if (nights.length === 0) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-3">Night-by-night</h2>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[360px]">
          <thead>
            <tr className="text-left text-slate-500 border-b">
              <th className="pb-2 pr-3 font-medium">Date</th>
              <th className="pb-2 pr-3 font-medium">{myName}</th>
              <th className="pb-2 pr-3 font-medium">{theirName}</th>
              <th className="pb-2 font-medium">Night</th>
            </tr>
          </thead>
          <tbody>
            {nights.map((night) => {
              const scored = night.myWins + night.myLosses + night.theirWins + night.theirLosses;
              const youWon  = night.myWins > night.theirWins;
              const theyWon = night.theirWins > night.myWins;
              const tied    = !youWon && !theyWon && scored > 0;
              const isActive = night.date === activeDate;

              const iPerfect    = night.myWins > 0 && night.myLosses === 0 && !night.hasPending;
              const theyPerfect = night.theirWins > 0 && night.theirLosses === 0 && !night.hasPending;

              const formattedDate = new Date(night.date + "T12:00:00Z").toLocaleDateString("en-US", {
                weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
              });

              return (
                <tr
                  key={night.date}
                  className={`border-b last:border-0 transition-colors ${
                    isActive ? "bg-slate-50" : ""
                  }`}
                >
                  <td className="py-2 pr-3">
                    <Link
                      href={`/competitions/${competitionId}?date=${night.date}`}
                      className="text-rink font-medium hover:underline whitespace-nowrap"
                    >
                      {formattedDate}
                      {isActive && (
                        <span className="ml-1.5 text-[10px] bg-rink text-white rounded px-1 py-0.5 font-normal align-middle">
                          viewing
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {scored === 0 && !night.hasPending ? "—" :
                     scored === 0 && night.hasPending ? <span className="text-slate-400">–</span> :
                     <span>
                       <span className="font-semibold">{night.myWins}</span>
                       <span className="text-slate-400">–{night.myLosses}</span>
                       {iPerfect && <span className="ml-1">🔥</span>}
                     </span>
                    }
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {scored === 0 ? <span className="text-slate-400">–</span> :
                     <span>
                       <span className="font-semibold">{night.theirWins}</span>
                       <span className="text-slate-400">–{night.theirLosses}</span>
                       {theyPerfect && <span className="ml-1">🔥</span>}
                     </span>
                    }
                  </td>
                  <td className="py-2">
                    {night.hasPending && scored === 0 ? (
                      <span className="text-slate-400 text-xs">No picks yet</span>
                    ) : night.hasPending ? (
                      <span className="text-amber-600 text-xs font-medium">In progress</span>
                    ) : scored === 0 ? (
                      <span className="text-slate-400 text-xs">—</span>
                    ) : youWon ? (
                      <span className="text-green-600 font-semibold text-xs">You won</span>
                    ) : theyWon ? (
                      <span className="text-red-500 font-semibold text-xs">You lost</span>
                    ) : (
                      <span className="text-slate-400 text-xs">Tied</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
