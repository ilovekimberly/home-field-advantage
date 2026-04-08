"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileForm({
  currentName,
  avatarUrl,
  email,
}: {
  currentName: string;
  avatarUrl: string | null;
  email: string;
}) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setSaved(false); setError(null);

    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });

    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to save");
    }
  }

  return (
    <div className="card space-y-6">
      {/* Avatar + email */}
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Profile photo"
            className="w-16 h-16 rounded-full object-cover ring-2 ring-slate-200"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-rink flex items-center justify-center text-white text-2xl font-bold">
            {currentName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div className="font-semibold text-slate-800">{currentName}</div>
          <div className="text-sm text-slate-500">{email}</div>
          {avatarUrl && (
            <div className="text-xs text-slate-400 mt-0.5">Photo from Google</div>
          )}
        </div>
      </div>

      {/* Display name form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Display name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            maxLength={30}
            className="input w-full"
            placeholder="Your name"
          />
          <p className="text-xs text-slate-400 mt-1">
            This is what your opponents see. {30 - name.length} characters remaining.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || name.trim() === currentName} className="btn-primary">
            {busy ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="text-green-700 text-sm">Saved ✓</span>}
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>
      </form>
    </div>
  );
}
