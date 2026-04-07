// Shared Resend email helper.
// All emails sent by the app go through sendEmail() so the Resend API
// call and error handling live in one place.

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("sendEmail: RESEND_API_KEY is not set");
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Home Field Advantage <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("sendEmail: Resend error", err);
    return false;
  }

  return true;
}

// ── Email templates ────────────────────────────────────────────────────────

function wrapper(content: string) {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#222;">
      ${content}
      <hr style="margin-top:40px;border:none;border-top:1px solid #eee;" />
      <p style="color:#aaa;font-size:12px;margin-top:16px;">
        Home Field Advantage · NHL Pick'em
      </p>
    </div>
  `;
}

function button(href: string, label: string) {
  return `
    <a href="${href}"
       style="display:inline-block;margin-top:24px;padding:14px 28px;
              background:#0b1f3a;color:#fff;text-decoration:none;
              border-radius:8px;font-size:16px;font-weight:600;">
      ${label}
    </a>
  `;
}

// Sent to the player who needs to make the next pick.
export function yourTurnEmail({
  toName,
  opponentName,
  competitionName,
  competitionUrl,
  gamesRemaining,
  pickNumber,
}: {
  toName: string;
  opponentName: string;
  competitionName: string;
  competitionUrl: string;
  gamesRemaining: number;
  pickNumber: number;
}) {
  return {
    subject: `🏒 Your pick #${pickNumber} is up — ${competitionName}`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">You're on the clock!</h1>
      <p style="font-size:16px;line-height:1.6;">
        <strong>${opponentName}</strong> just made their pick in
        <strong>${competitionName}</strong>. It's your turn — pick #${pickNumber}.
      </p>
      <p style="font-size:15px;color:#555;">
        ${gamesRemaining} game${gamesRemaining !== 1 ? "s" : ""} still available to pick from tonight.
      </p>
      ${button(competitionUrl, "Make your pick →")}
    `),
  };
}

// Sent to the creator when someone accepts their invite.
export function opponentJoinedEmail({
  toName,
  opponentName,
  competitionName,
  competitionUrl,
}: {
  toName: string;
  opponentName: string;
  competitionName: string;
  competitionUrl: string;
}) {
  return {
    subject: `🏒 ${opponentName} joined your competition!`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">Challenge accepted!</h1>
      <p style="font-size:16px;line-height:1.6;">
        <strong>${opponentName}</strong> just joined <strong>${competitionName}</strong>.
        Head over to make your first picks when the games start.
      </p>
      ${button(competitionUrl, "View competition →")}
    `),
  };
}
