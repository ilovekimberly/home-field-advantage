import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl space-y-16">

      {/* Hero */}
      <section className="text-center py-6">
        <div className="inline-flex items-center gap-2 bg-ice border border-rink/20 text-rink text-sm font-semibold px-4 py-1.5 rounded-full mb-5">
          🏒 Pick'em · Draft · Compete
        </div>
        <h1 className="text-4xl font-extrabold text-slate-900 mb-4 leading-tight">
          How My Home Field works
        </h1>
        <p className="text-slate-500 text-lg leading-relaxed max-w-xl mx-auto">
          You and a friend draft game picks each night, sit back while results roll in,
          and settle the debate once and for all.
        </p>
      </section>

      {/* Step 1 — Create */}
      <section className="relative">
        <div className="flex items-start gap-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-rink text-white flex items-center justify-center text-xl font-black shadow-md">
            1
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Create a competition</h2>
            <p className="text-slate-500 mb-5">
              Pick your sport, set the duration, and send an invite link to your opponent.
              That's it — no accounts needed for them to join.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { emoji: "🏒", label: "NHL", sub: "Oct → Apr" },
                { emoji: "⚾", label: "MLB", sub: "Mar → Sep" },
                { emoji: "⚽", label: "Premier League", sub: "Aug → May" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border-2 border-slate-100 bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
                  <span className="text-2xl">{s.emoji}</span>
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{s.label}</div>
                    <div className="text-xs text-slate-400">{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-l-4 border-dashed border-slate-200 ml-6 h-6" />

      {/* Step 2 — Duration */}
      <section>
        <div className="flex items-start gap-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-rink text-white flex items-center justify-center text-xl font-black shadow-md">
            2
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Choose how long it runs</h2>
            <p className="text-slate-500 mb-5">
              Quick one-night throwdown or a full-season war of attrition — your call.
            </p>
            <div className="grid gap-3">
              {[
                { emoji: "⚡", label: "Single day / Gameweek", desc: "One slate. Settle it tonight. Great for big game nights.", highlight: false },
                { emoji: "📅", label: "One week / 4 gameweeks", desc: "A short series where every pick night counts.", highlight: false },
                { emoji: "🏅", label: "Full regular season", desc: "NHL or MLB — all the way to the final game of the regular season.", highlight: false },
                { emoji: "🏆", label: "Full playoffs", desc: "Only available when the playoffs are active. Every series, every round — until the cup is lifted.", highlight: true },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-xl px-5 py-4 flex gap-4 items-start border-2 ${
                    item.highlight
                      ? "bg-ice border-rink/30 shadow-sm"
                      : "bg-white border-slate-100"
                  }`}
                >
                  <span className="text-2xl mt-0.5">{item.emoji}</span>
                  <div>
                    <div className={`font-bold text-sm ${item.highlight ? "text-rink" : "text-slate-800"}`}>{item.label}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-l-4 border-dashed border-slate-200 ml-6 h-6" />

      {/* Step 3 — Snake draft */}
      <section>
        <div className="flex items-start gap-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-rink text-white flex items-center justify-center text-xl font-black shadow-md">
            3
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Draft your picks — snake style</h2>
            <p className="text-slate-500 mb-5">
              You don't just pick any game you want. You take turns. This keeps it fair
              and makes every selection meaningful.
            </p>

            {/* Two draft style examples */}
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              {/* Standard snake */}
              <div className="rounded-2xl bg-slate-900 p-4">
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">Standard snake — 8 games</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "Pick 1", you: true },
                    { label: "Pick 2", you: false },
                    { label: "Pick 3", you: false },
                    { label: "Pick 4", you: true },
                    { label: "Pick 5", you: false },
                    { label: "Pick 6", you: true },
                    { label: "Pick 7", you: true },
                    { label: "Pick 8", you: false },
                  ].map((p, i) => (
                    <div key={i} className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg text-xs font-bold border ${p.you ? "bg-rink border-rink text-white" : "bg-slate-700 border-slate-600 text-slate-200"}`}>
                      <span className="text-[9px] font-normal opacity-70 mb-0.5">{p.label}</span>
                      {p.you ? "You" : "Them"}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2.5">Pair at the start, alternate through the middle, pair at the end.</p>
              </div>

              {/* Balanced snake */}
              <div className="rounded-2xl bg-slate-900 p-4">
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">Balanced snake — 8 games</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "Pick 1", you: true },
                    { label: "Pick 2", you: false },
                    { label: "Pick 3", you: false },
                    { label: "Pick 4", you: true },
                    { label: "Pick 5", you: true },
                    { label: "Pick 6", you: false },
                    { label: "Pick 7", you: false },
                    { label: "Pick 8", you: true },
                  ].map((p, i) => (
                    <div key={i} className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg text-xs font-bold border ${p.you ? "bg-rink border-rink text-white" : "bg-slate-700 border-slate-600 text-slate-200"}`}>
                      <span className="text-[9px] font-normal opacity-70 mb-0.5">{p.label}</span>
                      {p.you ? "You" : "Them"}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2.5">Single first pick, then strict pairs throughout — no end-of-draft bunching.</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">Both styles always give each player the same number of picks. You choose which pattern to use when you create the competition.</p>

            <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-3.5 flex gap-3">
              <span className="text-xl">🔄</span>
              <div>
                <div className="font-bold text-amber-900 text-sm">Who picks first?</div>
                <div className="text-sm text-amber-700 mt-0.5">
                  The player with the better record gets first pick. Tied? It alternates night to night.
                  New competition — the creator goes first.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-l-4 border-dashed border-slate-200 ml-6 h-6" />

      {/* Step 4 — Defer */}
      <section>
        <div className="flex items-start gap-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-rink text-white flex items-center justify-center text-xl font-black shadow-md">
            4
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">The defer move</h2>
            <p className="text-slate-500 mb-5">
              On weekly and season competitions with 4+ games on the slate, the player
              with pick priority gets a strategic choice before anyone picks.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border-2 border-rink bg-ice px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">🎯</span>
                  <div className="font-bold text-rink text-sm">Go first — keep pick #1</div>
                </div>
                <div className="text-sm text-slate-600">
                  You know what game you want — take it. First pick is yours.
                </div>
              </div>
              <div className="rounded-xl border-2 border-slate-200 bg-white px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">🧠</span>
                  <div className="font-bold text-slate-800 text-sm">Defer — take picks #2 and #3</div>
                </div>
                <div className="text-sm text-slate-600">
                  Let your opponent go first, then you get the next two in a row. Smart
                  when the top game is a coin flip.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-l-4 border-dashed border-slate-200 ml-6 h-6" />

      {/* Step 5 — Pick types */}
      <section>
        <div className="flex items-start gap-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-rink text-white flex items-center justify-center text-xl font-black shadow-md">
            5
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Optional pick types</h2>
            <p className="text-slate-500 mb-5">
              When creating a competition you can unlock additional pick types. Each one
              uses a draft pick slot — the same cap applies. Moneyline odds are always
              shown next to team buttons as context, regardless of which types are enabled.
            </p>

            {/* Over/Under */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">⚖️</span>
                <h3 className="font-bold text-slate-800">Over/Under</h3>
              </div>
              <div className="grid gap-3">
                {[
                  {
                    icon: "⬆️",
                    label: "Over",
                    desc: "You think it'll be a high-scoring game. If the final total beats the line, you win.",
                    color: "border-green-200 bg-green-50",
                  },
                  {
                    icon: "⬇️",
                    label: "Under",
                    desc: "You're backing the defense. If the final total comes in below the line, you win.",
                    color: "border-blue-100 bg-blue-50",
                  },
                  {
                    icon: "🎯",
                    label: "Lands exactly on the line",
                    desc: "No push — a final total that hits the line exactly is scored as a loss.",
                    color: "border-slate-200 bg-slate-50",
                  },
                ].map((item) => (
                  <div key={item.label} className={`rounded-xl border-2 px-5 py-3.5 flex gap-4 items-start ${item.color}`}>
                    <span className="text-xl mt-0.5">{item.icon}</span>
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{item.label}</div>
                      <div className="text-sm text-slate-500 mt-0.5">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Spread */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">⚡</span>
                <h3 className="font-bold text-slate-800">Spread (Puck/Run line)</h3>
              </div>
              <div className="grid gap-3">
                {[
                  {
                    icon: "✅",
                    label: "Pick a team to cover",
                    desc: "Instead of picking a winner outright, you pick a team to win by more than the spread (favorite) or lose by less (underdog).",
                    color: "border-green-200 bg-green-50",
                  },
                  {
                    icon: "🤝",
                    label: "Push = loss",
                    desc: "If the final margin lands exactly on the spread line, it counts as a loss — no pushes.",
                    color: "border-slate-200 bg-slate-50",
                  },
                ].map((item) => (
                  <div key={item.label} className={`rounded-xl border-2 px-5 py-3.5 flex gap-4 items-start ${item.color}`}>
                    <span className="text-xl mt-0.5">{item.icon}</span>
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{item.label}</div>
                      <div className="text-sm text-slate-500 mt-0.5">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <span>📊</span>
              All lines and odds are pulled from live markets and locked in when you make your pick.
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-l-4 border-dashed border-slate-200 ml-6 h-6" />

      {/* Step 6 — Scoring */}
      <section>
        <div className="flex items-start gap-6">
          <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-rink text-white flex items-center justify-center text-xl font-black shadow-md">
            6
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Scoring — fully automatic</h2>
            <p className="text-slate-500 mb-5">
              Results come in overnight. No manual updating, no spreadsheets, no drama.
            </p>
            <div className="grid gap-3">
              {[
                { icon: "✅", label: "Your team wins", sub: "You get a W. That's the game.", color: "border-green-200 bg-green-50" },
                { icon: "❌", label: "Your team loses", sub: "You get an L. Accountability is part of the fun.", color: "border-red-200 bg-red-50" },
                { icon: "🤝", label: "Draw (EPL only)", sub: "Counts as a push — no win, no loss.", color: "border-slate-200 bg-slate-50" },
                { icon: "🔒", label: "Game starts → pick locks", sub: "Once the puck drops (or first pitch) that pick is locked in.", color: "border-slate-200 bg-slate-50" },
              ].map((item) => (
                <div key={item.label} className={`rounded-xl border-2 px-5 py-3.5 flex gap-4 items-start ${item.color}`}>
                  <span className="text-xl mt-0.5">{item.icon}</span>
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{item.label}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{item.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5">
              <span>⏱</span>
              Scores update automatically each morning. Live scores refresh on the competition page every 60 seconds while games are in progress.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden rounded-3xl bg-rink px-8 py-10 text-center shadow-lg">
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 50%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }}
        />
        <div className="relative">
          <div className="flex items-center justify-center gap-3 text-4xl mb-3">
            <span>🏒</span>
            <span>⚾</span>
            <span>⚽</span>
          </div>
          <h2 className="text-2xl font-extrabold text-white mb-2">Ready to settle the debate?</h2>
          <p className="text-white/70 mb-6 text-sm">Create a competition and send your opponent the link. Takes 60 seconds.</p>
          <Link href="/competitions/new" className="inline-flex items-center gap-2 bg-white text-rink font-bold px-8 py-3 rounded-xl hover:bg-ice transition-colors shadow-md text-base">
            Create a competition →
          </Link>
        </div>
      </section>

    </div>
  );
}
