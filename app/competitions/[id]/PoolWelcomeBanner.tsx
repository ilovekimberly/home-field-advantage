"use client";
import { useState } from "react";

const STEPS = [
  {
    emoji: "🏆",
    title: "Pick every match",
    desc: "For each game, pick who you think wins — home team, away team, or draw. Everyone in the pool picks independently.",
  },
  {
    emoji: "🔒",
    title: "Picks lock at kickoff",
    desc: "Once a match kicks off, picks are locked. Make sure you've picked before the whistle — no changes after.",
  },
  {
    emoji: "👀",
    title: "Reveal after lock",
    desc: "After kickoff you'll see what everyone else picked. That's when the trash talk starts.",
  },
  {
    emoji: "📊",
    title: "Leaderboard tracks it all",
    desc: "Every correct pick is a win, every wrong one a loss. The leaderboard updates in real time as results come in.",
  },
];

export default function PoolWelcomeBanner({ sport }: { sport?: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isFIFA = sport === "FIFA";

  return (
    <div className="card border-2 border-rink/20 bg-gradient-to-br from-rink/5 to-white relative">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>

      <div className="pr-6">
        <h2 className="text-lg font-bold text-slate-800 mb-0.5">
          Welcome to the pool! 🎉
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          {isFIFA
            ? "Here's how the World Cup pool works:"
            : "Here's how the pool works:"}
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          {STEPS.map((step) => (
            <div key={step.title} className="flex gap-3">
              <span className="text-xl shrink-0 mt-0.5">{step.emoji}</span>
              <div>
                <div className="text-sm font-semibold text-slate-700">{step.title}</div>
                <div className="text-xs text-slate-500 leading-relaxed">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {isFIFA && (
          <div className="rounded-lg bg-rink/10 px-3 py-2 text-xs text-rink font-medium">
            ⚽ For each match, your options are <strong>Home win</strong>, <strong>Away win</strong>, or <strong>Draw</strong>. All three are worth the same — 1 win.
          </div>
        )}

        <button
          onClick={() => setDismissed(true)}
          className="mt-4 btn-primary text-sm py-2 px-4"
        >
          Got it, let's pick →
        </button>
      </div>
    </div>
  );
}
