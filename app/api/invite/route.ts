import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

// POST /api/invite
// Body: { competitionId, toEmail }
// Sends an invite email via Resend and records it in the invites table.
export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { competitionId, toEmail } = await req.json();
  if (!competitionId || !toEmail) {
    return NextResponse.json({ error: "competitionId and toEmail are required" }, { status: 400 });
  }

  // Verify the caller is the creator of this competition.
  const { data: comp } = await supabase
    .from("competitions")
    .select("*, profiles!competitions_creator_id_fkey(display_name)")
    .eq("id", competitionId)
    .eq("creator_id", user.id)
    .single();

  if (!comp) {
    return NextResponse.json({ error: "competition not found or not yours" }, { status: 404 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://home-field-advantage.vercel.app";
  const inviteUrl = `${siteUrl}/join/${comp.invite_token}`;
  const creatorName = (comp.profiles as any)?.display_name ?? "Your friend";

  const ok = await sendEmail({
    to: toEmail,
    subject: `${creatorName} challenged you to a pick'em!`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
        <h1 style="font-size:24px;color:#0b1f3a;margin-bottom:8px;">🏒 You've been challenged!</h1>
        <p style="color:#444;font-size:16px;line-height:1.5;">
          <strong>${creatorName}</strong> has invited you to a 1v1 NHL pick'em competition:
          <strong>${comp.name}</strong>.
        </p>
        <p style="color:#444;font-size:16px;line-height:1.5;">
          Each night of the slate you'll take turns drafting game picks. Best record wins.
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;margin-top:24px;padding:14px 28px;
                  background:#0b1f3a;color:#fff;text-decoration:none;
                  border-radius:8px;font-size:16px;font-weight:600;">
          Accept the challenge →
        </a>
        <p style="margin-top:32px;color:#999;font-size:12px;">
          Or copy this link: ${inviteUrl}
        </p>
        <hr style="margin-top:40px;border:none;border-top:1px solid #eee;" />
        <p style="color:#aaa;font-size:12px;">Home Field Advantage · NHL Pick'em</p>
      </div>
    `,
  });

  if (!ok) {
    return NextResponse.json({ error: "Failed to send email — check RESEND_API_KEY" }, { status: 502 });
  }

  // Record the invite in the database.
  await supabase.from("invites").upsert({
    competition_id: competitionId,
    invited_email: toEmail,
    invited_by: user.id,
  }, { onConflict: "competition_id,invited_email" });

  return NextResponse.json({ ok: true });
}
