import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <div className="max-w-2xl space-y-12">

      {/* Hero */}
      <section>
        <h1 className="text-3xl font-bold mb-3">How it works</h1>
        <p className="text-slate-600 text-lg leading-relaxed">
          Home Field Advantage is a 1v1 pick'em game. You and a friend take turns
          drafting game picks each night, then sit back and watch the results roll in.
          Best record wins. Simple as that.
        </p>
      </section>

      {/* Competition types */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🏆</span>
          <h2 className="text-xl font-bold">Pick your competition</h2>
        </div>
        <p className="text-slate-600 mb-4">
          When you create a competition you pick the sport and how long it runs.
        </p>
        <div className="grid gap-3">
          {[
            {
              label: "Single day / Gameweek",
              desc: "One night of picks. Great for a quick head-to-head when there's a big slate. For Premier League, this covers the whole gameweek fixture list.",
              emoji: "⚡",
            },
            {
              label: "One week / 4 gameweeks",
              desc: "A short series. You pick every night (or every gameweek) and accumulate wins. Good for a rivalry that doesn't need a full season commitment.",
              emoji: "📅",
            },
            {
              label: "Full season",
              desc: "The whole thing. NHL runs October to April, MLB March to September, EPL August to May. If you're serious about bragging rights, this is it.",
              emoji: "🏅",
            },
          ].map((item) => (
            <div key={item.label} className="card flex gap-4">
              <span className="text-2xl">{item.emoji}</span>
              <div>
                <div className="font-semibold">{item.label}</div>
                <div className="text-sm text-slate-500 mt-0.5">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Snake draft */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🐍</span>
          <h2 className="text-xl font-bold">The snake draft</h2>
        </div>
        <p className="text-slate-600 mb-4">
          Each night you don't just pick any game you want — you take turns. This
          keeps it fair and makes every pick feel meaningful.
        </p>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-5 space-y-3 text-sm">
          <p className="text-slate-700">
            <strong>Who picks first?</strong> The player with the better record going
            into that night gets first pick. If it's tied, it alternates from the night
            before. New competition? The creator goes first.
          </p>
          <p className="text-slate-700">
            <strong>How does the order go?</strong> Say there are 6 games tonight and
            you're going first. The order looks like this:
          </p>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            {["You #1", "Them #2", "Them #3", "You #4", "You #5", "Them #6"].map((p, i) => (
              <span
                key={i}
                className={`px-3 py-1.5 rounded-full font-semibold ${
                  p.startsWith("You")
                    ? "bg-rink text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {p}
              </span>
            ))}
          </div>
          <p className="text-slate-700">
            <strong>Odd number of games?</strong> The last game gets dropped — no one
            picks it. Unless there are 3 or fewer games, in which case you each pick one
            and the last is dropped (or you each get one in a 2-game night).
          </p>
          <p className="text-slate-700">
            <strong>End of night twist:</strong> On slates of 6+ picks, the last three
            always go: first-pick player, first-pick player, second-pick player. This
            prevents one person from stacking the end of the draft.
          </p>
        </div>
      </section>

      {/* Defer rule */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🔄</span>
          <h2 className="text-xl font-bold">The defer move</h2>
        </div>
        <p className="text-slate-600 mb-4">
          On weekly and season competitions with 4+ games on the slate, the player with
          pick priority gets a choice before anyone picks anything.
        </p>
        <div className="grid gap-3">
          <div className="card border-rink border">
            <div className="font-semibold mb-1">Go first — keep pick #1</div>
            <div className="text-sm text-slate-500">
              You get the first overall pick. Classic. You know what game you want, you
              take it.
            </div>
          </div>
          <div className="card">
            <div className="font-semibold mb-1">Defer — take picks #2 and #3</div>
            <div className="text-sm text-slate-500">
              You let your opponent pick first, then you get the next two picks in a row.
              Smart move when the top game is a coin flip and you'd rather have two
              solid picks than one great one.
            </div>
          </div>
        </div>
      </section>

      {/* Scoring */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">📊</span>
          <h2 className="text-xl font-bold">Scoring</h2>
        </div>
        <div className="space-y-3 text-slate-600">
          <div className="card flex gap-4">
            <span className="text-xl">✅</span>
            <div>
              <div className="font-semibold text-slate-800">Your team wins → you get a W</div>
              <div className="text-sm mt-0.5">Simple. Your team wins the game, you win the pick.</div>
            </div>
          </div>
          <div className="card flex gap-4">
            <span className="text-xl">❌</span>
            <div>
              <div className="font-semibold text-slate-800">Your team loses → you get an L</div>
              <div className="text-sm mt-0.5">That's the game. Accountability is part of the fun.</div>
            </div>
          </div>
          <div className="card flex gap-4">
            <span className="text-xl">🤝</span>
            <div>
              <div className="font-semibold text-slate-800">Draw → push (EPL only)</div>
              <div className="text-sm mt-0.5">
                Draws in the Premier League count as a push — no win, no loss. It
                happens, especially in a tight fixture.
              </div>
            </div>
          </div>
          <div className="card flex gap-4">
            <span className="text-xl">🔒</span>
            <div>
              <div className="font-semibold text-slate-800">Game starts → pick locks</div>
              <div className="text-sm mt-0.5">
                Once a game's puck drops (or first pitch, or kickoff), that game is
                locked. You can still pick other games on the slate that haven't started,
                but no jumping in after tip-off.
              </div>
            </div>
          </div>
        </div>
        <p className="text-sm text-slate-400 mt-4">
          Scores are updated automatically a few times each morning after games finish.
          You'll get an email when it's your turn to pick, and live scores update on
          the competition page every 60 seconds while games are in progress.
        </p>
      </section>

      {/* CTA */}
      <section className="card bg-ice border-rink border text-center py-8">
        <p className="text-lg font-semibold text-rink mb-4">Ready to challenge someone?</p>
        <Link href="/competitions/new" className="btn-primary">
          Create a competition
        </Link>
      </section>

    </div>
  );
}
