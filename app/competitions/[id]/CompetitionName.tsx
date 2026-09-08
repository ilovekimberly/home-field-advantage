"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const MAX_NAME_LENGTH = 60;

// Competition title. For the creator it's editable in place — click the pencil,
// type, Enter to save (Escape to cancel). Everyone else just sees the heading.
export default function CompetitionName({
  competitionId,
  name,
  canEdit,
}: {
  competitionId: string;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep in sync if the name changes from elsewhere (e.g. router.refresh).
  useEffect(() => { setValue(name); }, [name]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function cancel() {
    setValue(name);
    setError(null);
    setEditing(false);
  }

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) { setError("Name can't be empty"); return; }
    if (trimmed === name) { setEditing(false); return; }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Couldn't rename");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return <h1 className="text-2xl font-bold">{name}</h1>;
  }

  if (editing) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={value}
            maxLength={MAX_NAME_LENGTH}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
            className="input text-2xl font-bold py-1 min-w-0 flex-1"
            aria-label="Competition name"
          />
          <button
            onClick={save}
            disabled={busy}
            className="btn-primary text-sm py-1 px-3 shrink-0 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="btn-ghost text-sm py-1 px-2 shrink-0"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <h1 className="text-2xl font-bold">{name}</h1>
      <button
        onClick={() => setEditing(true)}
        className="text-slate-300 hover:text-rink transition-colors shrink-0"
        title="Rename competition"
        aria-label="Rename competition"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      </button>
    </div>
  );
}
