"use client";
import { useEffect, useState } from "react";

type Friend = { id: string; userId: string; name: string; email: string | null };

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Immediate mode (InvitePanel) ──────────────────────────────────────────────
// Shows accepted friends with a one-tap "Invite" button that fires /api/invite.

export function FriendsInviterImmediate({
  competitionId,
}: {
  competitionId: string;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => r.json())
      .then((d) => setFriends((d.friends ?? []).filter((f: Friend) => f.email)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || friends.length === 0) return null;

  async function invite(friend: Friend) {
    if (!friend.email || invited.has(friend.userId)) return;
    setBusy(friend.userId);
    await fetch("/api/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ competitionId, toEmail: friend.email }),
    }).catch(() => {});
    setInvited((prev) => new Set([...prev, friend.userId]));
    setBusy(null);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Invite from friends
      </p>
      {friends.map((f) => {
        const done = invited.has(f.userId);
        const isBusy = busy === f.userId;
        return (
          <div
            key={f.userId}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-white border border-slate-200"
          >
            <div className="w-7 h-7 rounded-full bg-rink/10 text-rink flex items-center justify-center text-[10px] font-bold shrink-0">
              {initials(f.name)}
            </div>
            <span className="flex-1 text-sm font-medium text-slate-700 truncate min-w-0">
              {f.name}
            </span>
            <button
              onClick={() => invite(f)}
              disabled={done || isBusy}
              className={`shrink-0 text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                done
                  ? "bg-green-100 text-green-700 cursor-default"
                  : "bg-rink text-white hover:bg-rink/90 disabled:opacity-50"
              }`}
            >
              {isBusy ? "…" : done ? "Invited ✓" : "Invite"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Select mode (creation form) ───────────────────────────────────────────────
// Shows accepted friends as toggleable chips. Selected friends' emails are
// passed up via onToggle so the parent can include them in the invite batch.

export function FriendsInviterSelect({
  selectedEmails,
  onToggle,
}: {
  selectedEmails: Set<string>;
  onToggle: (email: string) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => r.json())
      .then((d) => setFriends((d.friends ?? []).filter((f: Friend) => f.email)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || friends.length === 0) return null;

  return (
    <div>
      <p className="text-xs text-slate-500 mb-1.5">Tap to invite from your friends:</p>
      <div className="flex flex-wrap gap-2">
        {friends.map((f) => {
          const selected = selectedEmails.has(f.email!);
          return (
            <button
              key={f.userId}
              type="button"
              onClick={() => onToggle(f.email!)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border-2 transition-colors ${
                selected
                  ? "border-rink bg-rink text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-rink/40"
              }`}
            >
              <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
              }`}>
                {initials(f.name)}
              </span>
              {f.name}
              {selected && <span className="text-xs">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
