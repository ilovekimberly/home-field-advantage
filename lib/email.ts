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
      from: "My Home Field <noreply@myhomefield.team>",
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

const SPORT_EMOJI: Record<string, string> = { NHL: "🏒", MLB: "⚾", EPL: "⚽", FIFA: "🏆" };
const SPORT_GAME_WORD: Record<string, string> = { NHL: "game", MLB: "game", EPL: "match", FIFA: "match" };
const SPORT_START_PHRASE: Record<string, string> = {
  NHL: "puck drop",
  MLB: "first pitch",
  EPL: "kickoff",
  FIFA: "kickoff",
};

function sportEmoji(sport?: string) { return SPORT_EMOJI[sport ?? "NHL"] ?? "🏒"; }
function gameWord(sport?: string) { return SPORT_GAME_WORD[sport ?? "NHL"] ?? "game"; }
function startPhrase(sport?: string) { return SPORT_START_PHRASE[sport ?? "NHL"] ?? "puck drop"; }

function wrapper(content: string) {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#222;">
      ${content}
      <hr style="margin-top:40px;border:none;border-top:1px solid #eee;" />
      <p style="color:#aaa;font-size:12px;margin-top:16px;">
        My Home Field · Pick'em
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
  sport,
}: {
  toName: string;
  opponentName: string;
  competitionName: string;
  competitionUrl: string;
  gamesRemaining: number;
  pickNumber: number;
  sport?: string;
}) {
  const gw = gameWord(sport);
  return {
    subject: `${sportEmoji(sport)} Your pick #${pickNumber} is up — ${competitionName}`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">You're on the clock!</h1>
      <p style="font-size:16px;line-height:1.6;">
        <strong>${opponentName}</strong> just made their pick in
        <strong>${competitionName}</strong>. It's your turn — pick #${pickNumber}.
      </p>
      <p style="font-size:15px;color:#555;">
        ${gamesRemaining} ${gw}${gamesRemaining !== 1 ? "s" : ""} still available to pick from.
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
  sport,
}: {
  toName: string;
  opponentName: string;
  competitionName: string;
  competitionUrl: string;
  sport?: string;
}) {
  return {
    subject: `${sportEmoji(sport)} ${opponentName} joined your competition!`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">Challenge accepted!</h1>
      <p style="font-size:16px;line-height:1.6;">
        <strong>${opponentName}</strong> just joined <strong>${competitionName}</strong>.
        Head over to make your first picks before ${startPhrase(sport)}.
      </p>
      ${button(competitionUrl, "View competition →")}
    `),
  };
}

// Sent to the first picker ~2 hours before the first game of the night.
export function picksOpenEmail({
  toName,
  opponentName,
  competitionName,
  competitionUrl,
  firstGameTime,
  gameCount,
  hasPriority,
  sport,
}: {
  toName: string;
  opponentName: string;
  competitionName: string;
  competitionUrl: string;
  firstGameTime: string; // e.g. "7:00 PM ET"
  gameCount: number;
  hasPriority: boolean;
  sport?: string;
}) {
  const gw = gameWord(sport);
  const sp = startPhrase(sport);
  const priorityNote = hasPriority
    ? `<p style="font-size:15px;color:#555;line-height:1.6;">
        You have <strong>pick priority</strong> tonight — head over to choose whether
        to pick first or defer and take picks&nbsp;#2&nbsp;&amp;&nbsp;#3.
       </p>`
    : `<p style="font-size:15px;color:#555;line-height:1.6;">
        <strong>${opponentName}</strong> has pick priority tonight.
        Head over once they've made their choice to start picking.
       </p>`;

  return {
    subject: `${sportEmoji(sport)} Tonight's picks are open — ${competitionName}`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">Picks are open!</h1>
      <p style="font-size:16px;line-height:1.6;">
        There ${gameCount === 1 ? "is" : "are"} <strong>${gameCount} ${gw}${gameCount !== 1 ? "s" : ""}</strong>
        on the slate for <strong>${competitionName}</strong>.
        First ${sp} at <strong>${firstGameTime}</strong>.
      </p>
      ${priorityNote}
      ${button(competitionUrl, "Make your picks →")}
    `),
  };
}

// Sent to the creator when a competition is auto-cancelled due to no opponent joining.
export function competitionCancelledEmail({
  toName,
  competitionName,
  reason,
  newCompUrl,
  sport,
}: {
  toName: string;
  competitionName: string;
  reason: "daily" | "weekly";
  newCompUrl: string;
  sport?: string;
}) {
  const explanation = reason === "daily"
    ? "Tonight's games have started and no one joined in time."
    : "3 days have passed and no one accepted the invite.";

  return {
    subject: `${sportEmoji(sport)} Your competition "${competitionName}" was cancelled`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">Competition cancelled</h1>
      <p style="font-size:16px;line-height:1.6;">
        Your pick'em <strong>${competitionName}</strong> has been automatically cancelled.
        ${explanation}
      </p>
      <p style="font-size:15px;color:#555;line-height:1.6;">
        Ready to try again? Create a new competition and send your friend the invite link
        before the games start.
      </p>
      ${button(newCompUrl, "Create a new competition →")}
    `),
  };
}

// Sent to both players when someone sweeps all their picks in a night.
export function perfectNightEmail({
  toName,
  sweeper,
  isSweeper,
  wins,
  competitionName,
  competitionUrl,
  date,
  sport,
}: {
  toName: string;
  sweeper: string;
  isSweeper: boolean;
  wins: number;
  competitionName: string;
  competitionUrl: string;
  date: string;
  sport?: string;
}) {
  const formattedDate = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
  });
  const subject = isSweeper
    ? `🔥 Perfect night! You swept all ${wins} picks — ${competitionName}`
    : `🔥 ${sweeper} swept all ${wins} picks last night — ${competitionName}`;
  const headline = isSweeper ? "🔥 Perfect night!" : `🔥 ${sweeper} had a perfect night!`;
  const body = isSweeper
    ? `You swept all <strong>${wins} picks</strong> on ${formattedDate} in <strong>${competitionName}</strong>. Clean sheet!`
    : `<strong>${sweeper}</strong> swept all <strong>${wins} picks</strong> on ${formattedDate} in <strong>${competitionName}</strong>. Time to bounce back.`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";
  const perfectImages = ["perfect-1.gif", "perfect-2.gif", "perfect-3.gif"];
  const imgFile = perfectImages[Math.floor(Math.random() * perfectImages.length)];
  return {
    subject,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">${headline}</h1>
      <img
        src="${siteUrl}/${imgFile}"
        alt="PERFECT"
        width="400"
        style="display:block;max-width:100%;border-radius:8px;margin:12px 0;"
      />
      <p style="font-size:16px;line-height:1.6;">${body}</p>
      ${button(competitionUrl, "View competition →")}
    `),
  };
}

// Sent to all pool members on the morning of the competition's start date.
export function poolPicksOpenEmail({
  toName,
  competitionName,
  competitionUrl,
  sport,
  startDate,
}: {
  toName: string;
  competitionName: string;
  competitionUrl: string;
  sport?: string;
  startDate: string; // YYYY-MM-DD
}) {
  const emoji = sportEmoji(sport);
  const gw = gameWord(sport);
  const formattedDate = new Date(startDate + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
  const isFIFA = sport === "FIFA";

  return {
    subject: `${emoji} Picks are open — ${competitionName}`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">
        ${emoji} It's time to pick!
      </h1>
      <p style="font-size:16px;line-height:1.6;">
        Hey ${toName} — picks are now open for <strong>${competitionName}</strong>.
        The first ${gw}s kick off today, <strong>${formattedDate}</strong>.
      </p>
      ${isFIFA ? `
      <p style="font-size:15px;color:#555;line-height:1.6;">
        For each match, pick <strong>Home win</strong>, <strong>Away win</strong>, or <strong>Draw</strong>
        before kickoff. Picks lock the moment the match starts — don't wait too long!
      </p>
      ` : `
      <p style="font-size:15px;color:#555;line-height:1.6;">
        Pick the winner of each ${gw} before it starts. Picks lock at ${gameWord(sport)} time.
      </p>
      `}
      <p style="font-size:15px;color:#555;line-height:1.6;">
        After each ${gw} locks, you'll see what everyone else in the pool picked.
      </p>
      ${button(competitionUrl, "Make your picks →")}
    `),
  };
}

// Sent to the site owner when a support request or suggestion is submitted.
export function feedbackEmail({
  type,
  fromName,
  fromEmail,
  message,
}: {
  type: "support" | "suggestion";
  fromName: string;
  fromEmail: string;
  message: string;
}) {
  const isSupport = type === "support";
  const title = isSupport ? "New support request" : "New game/sport suggestion";
  const emoji = isSupport ? "🆘" : "💡";

  return {
    subject: `${emoji} ${title} from ${fromName}`,
    html: wrapper(`
      <h1 style="font-size:22px;color:#0b1f3a;margin-bottom:8px;">${title}</h1>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="font-size:13px;color:#888;padding:4px 0;width:80px;">From</td>
          <td style="font-size:14px;color:#222;padding:4px 0;">${fromName}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding:4px 0;">Email</td>
          <td style="font-size:14px;color:#222;padding:4px 0;">${fromEmail}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding:4px 0;">Type</td>
          <td style="font-size:14px;color:#222;padding:4px 0;">${isSupport ? "Support request" : "Suggestion"}</td>
        </tr>
      </table>
      <div style="background:#f8f9fa;border-left:4px solid #0b1f3a;padding:16px;border-radius:4px;font-size:15px;line-height:1.6;color:#333;white-space:pre-wrap;">${message}</div>
    `),
  };
}
