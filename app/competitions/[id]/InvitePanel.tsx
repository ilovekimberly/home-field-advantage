"use client";
import { useState } from "react";
import { FriendsInviterImmediate } from "@/app/components/FriendsInviter";

export default function InvitePanel({
  competitionId,
  inviteToken,
  siteUrl,
}: {
  competitionId: string;
  inviteToken: string;
  siteUrl: string;
}) {
  const inviteUrl = `${siteUrl}/join/${inviteToken}`;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [copied, setCopied] = useState(false);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true); setStatus("idle");
    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ competitionId, toEmail: email }),
    });
    setBusy(false);
    setStatus(res.ok ? "sent" : "error");
    if (res.ok) setEmail("");
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg bg-ice p-4 space-y-3">
      <p className="text-sm font-medium text-rink">Invite your opponent</p>

      {/* Friends quick-invite — only renders if user has accepted friends */}
      <FriendsInviterImmediate competitionId={competitionId} />

      {/* Shareable link */}
      <div className="flex gap-2 items-center">
        <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs border border-slate-200">
          {inviteUrl}
        </code>
        <button onClick={copyLink} className="btn-ghost text-xs whitespace-nowrap">
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>

      {/* Email invite */}
      <form onSubmit={sendInvite} className="flex gap-2">
        <input
          type="email"
          placeholder="friend@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input flex-1 text-sm"
          required
        />
        <button type="submit" disabled={busy} className="btn-primary whitespace-nowrap text-sm">
          {busy ? "Sending…" : "Send invite"}
        </button>
      </form>

      {status === "sent" && (
        <p className="text-green-700 text-sm">Invite sent! Your friend will get an email with the link.</p>
      )}
      {status === "error" && (
        <p className="text-red-600 text-sm">Failed to send — check that RESEND_API_KEY is set in Vercel.</p>
      )}
    </div>
  );
}
