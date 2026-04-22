"use client";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SupportPage() {
  const supabase = createSupabaseBrowserClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from session if logged in.
  useState(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? "");
        setName(user.user_metadata?.name ?? "");
      }
    });
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "support", name, email, message }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
  }

  if (done) {
    return (
      <div className="max-w-xl mx-auto card text-center py-12">
        <div className="text-4xl mb-4">✅</div>
        <h1 className="text-2xl font-bold mb-2">Got it!</h1>
        <p className="text-slate-500">
          Thanks for reaching out. We'll get back to you as soon as possible.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto card">
      <h1 className="text-2xl font-bold mb-1">Contact support</h1>
      <p className="text-slate-500 text-sm mb-6">
        Having an issue or have a question? Let us know and we'll get back to you.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Email address</span>
          <input
            type="email"
            className="input mt-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">What's going on?</span>
          <textarea
            className="input mt-1 h-36 resize-none"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the issue or question as clearly as you can..."
            required
          />
        </label>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button className="btn-primary w-full" disabled={busy || !message.trim()}>
          {busy ? "Sending…" : "Send message"}
        </button>
      </form>
    </div>
  );
}
