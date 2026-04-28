"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const SPORT_EMOJI: Record<string, string> = { NHL: "🏒", MLB: "⚾", EPL: "⚽" };

type FriendRequest = { id: string; name: string };

export default function TurnBadgeDropdown({
  competitions: initialCompetitions,
  friendRequests: initialFriendRequests = [],
}: {
  competitions: { id: string; name: string; sport: string }[];
  friendRequests?: FriendRequest[];
}) {
  const [open, setOpen] = useState(false);
  const [competitions, setCompetitions] = useState(initialCompetitions);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>(initialFriendRequests);
  const ref = useRef<HTMLDivElement>(null);

  // Re-fetch from the API so the badge clears after picks are made without a
  // full page reload (root layout server components don't re-render on router.refresh).
  async function refresh() {
    try {
      const res = await fetch("/api/notifications/turn", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCompetitions(data.competitions ?? []);
        setFriendRequests(data.friendRequests ?? []);
      }
    } catch {}
  }

  async function acceptFriend(id: string) {
    await fetch(`/api/friends/${id}`, { method: "PATCH" });
    setFriendRequests((prev) => prev.filter((r) => r.id !== id));
  }

  async function declineFriend(id: string) {
    await fetch(`/api/friends/${id}`, { method: "DELETE" });
    setFriendRequests((prev) => prev.filter((r) => r.id !== id));
  }

  // Refresh whenever the dropdown is opened.
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  // Poll every 30 s so the red dot clears even without opening the dropdown.
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  // Close when clicking outside.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative text-slate-400 hover:text-rink transition-colors p-1 rounded-full hover:bg-slate-100"
        aria-label="Pick notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {(competitions.length > 0 || friendRequests.length > 0) && (
          <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-slate-200 z-50 overflow-hidden">

          {/* Friend requests section */}
          {friendRequests.length > 0 && (
            <>
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Friend requests
                  <span className="ml-2 bg-rink text-white text-[10px] px-1.5 py-0.5 rounded-full">
                    {friendRequests.length}
                  </span>
                </p>
              </div>
              <ul className="border-b border-slate-100">
                {friendRequests.map((req) => (
                  <li key={req.id} className="flex items-center gap-2 px-4 py-3">
                    <span className="text-sm font-medium text-slate-700 flex-1 truncate">{req.name}</span>
                    <button
                      onClick={() => acceptFriend(req.id)}
                      className="text-xs font-semibold text-rink hover:underline shrink-0"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => declineFriend(req.id)}
                      className="text-xs text-slate-400 hover:text-red-400 shrink-0"
                    >
                      Decline
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Your turn to pick section */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {competitions.length > 0 ? "Your turn to pick" : "Picks"}
            </p>
          </div>
          {competitions.length > 0 ? (
            <ul>
              {competitions.map((comp) => (
                <li key={comp.id}>
                  <Link
                    href={`/competitions/${comp.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-xl leading-none">
                      {SPORT_EMOJI[comp.sport] ?? "🏒"}
                    </span>
                    <span className="text-sm font-medium text-slate-700 leading-snug">
                      {comp.name}
                    </span>
                    <span className="ml-auto text-slate-300 text-sm">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-slate-400 italic">
              {friendRequests.length === 0
                ? "You're all caught up — no picks needed right now."
                : "No picks needed right now."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
