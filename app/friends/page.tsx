"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const SPORT_EMOJI: Record<string, string> = { NHL: "🏒", MLB: "⚾", EPL: "⚽", FIFA: "🏆" };

type Friend        = { id: string; userId: string; name: string; status: string };
type Competition   = { id: string; name: string; sport: string; status: string; start_date: string };
type FriendWithComps = Friend & { competitions?: Competition[] };

export default function FriendsPage() {
  const [friends, setFriends]             = useState<FriendWithComps[]>([]);
  const [sentRequests, setSentRequests]   = useState<Friend[]>([]);
  const [received, setReceived]           = useState<Friend[]>([]);
  const [query, setQuery]                 = useState("");
  const [sending, setSending]             = useState(false);
  const [msg, setMsg]                     = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading]             = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [friendsRes, compsRes] = await Promise.all([
        fetch("/api/friends").then((r) => r.json()),
        fetch("/api/friends/competitions").then((r) => r.json()),
      ]);
      const compsByUser: Record<string, Competition[]> = compsRes.compsByUser ?? {};
      const enriched = (friendsRes.friends ?? []).map((f: Friend) => ({
        ...f,
        competitions: compsByUser[f.userId] ?? [],
      }));
      setFriends(enriched);
      setSentRequests(friendsRes.sentRequests ?? []);
      setReceived(friendsRes.receivedRequests ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSending(true);
    setMsg(null);
    const res  = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg({ text: `Friend request sent to ${data.name}!`, ok: true });
      setQuery("");
      load();
    } else {
      setMsg({ text: data.error ?? "Something went wrong.", ok: false });
    }
    setSending(false);
  }

  async function accept(id: string) {
    await fetch(`/api/friends/${id}`, { method: "PATCH" });
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/friends/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Friends</h1>

      {/* Add friend */}
      <section className="card">
        <h2 className="text-base font-semibold mb-3">Add a friend</h2>
        <form onSubmit={sendRequest} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or email address"
            className="input flex-1"
          />
          <button type="submit" disabled={sending || !query.trim()} className="btn-primary shrink-0">
            {sending ? "Sending…" : "Send request"}
          </button>
        </form>
        {msg && (
          <p className={`mt-2 text-sm ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</p>
        )}
      </section>

      {/* Pending received requests */}
      {received.length > 0 && (
        <section className="card">
          <h2 className="text-base font-semibold mb-3">
            Friend requests
            <span className="ml-2 bg-rink text-white text-xs px-1.5 py-0.5 rounded-full">{received.length}</span>
          </h2>
          <ul className="space-y-2">
            {received.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-700">{r.name}</span>
                <div className="flex gap-2">
                  <button onClick={() => accept(r.id)} className="btn-primary text-sm py-1 px-3">Accept</button>
                  <button onClick={() => remove(r.id)} className="btn-ghost text-sm py-1 px-3">Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Friends list */}
      <section>
        <h2 className="text-base font-semibold mb-3">
          {loading ? "Loading…" : friends.length === 0 ? "No friends yet" : `Friends (${friends.length})`}
        </h2>
        {friends.length > 0 && (
          <ul className="space-y-4">
            {friends.map((f) => (
              <li key={f.id} className="card">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="font-semibold text-slate-800">{f.name}</span>
                  <button
                    onClick={() => remove(f.id)}
                    className="text-xs text-slate-400 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
                {f.competitions && f.competitions.length > 0 ? (
                  <ul className="space-y-1.5 mt-2 border-t border-slate-100 pt-2">
                    {f.competitions.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/competitions/${c.id}`}
                          className="flex items-center gap-2 text-sm hover:text-rink transition-colors"
                        >
                          <span>{SPORT_EMOJI[c.sport] ?? "🏒"}</span>
                          <span className="font-medium">{c.name}</span>
                          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                            c.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                          }`}>
                            {c.status === "active" ? "Live" : c.status}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 mt-1 border-t border-slate-100 pt-2">No public competitions right now.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sent requests */}
      {sentRequests.length > 0 && (
        <section className="card">
          <h2 className="text-base font-semibold mb-3 text-slate-500">Pending sent requests</h2>
          <ul className="space-y-2">
            {sentRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-sm text-slate-600">
                <span>{r.name}</span>
                <button onClick={() => remove(r.id)} className="text-xs text-slate-400 hover:text-red-400">Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
