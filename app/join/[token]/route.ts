import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendEmail, opponentJoinedEmail } from "@/lib/email";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `/join/${params.token}`);
    return NextResponse.redirect(loginUrl);
  }

  const { data: comp, error } = await supabase
    .from("competitions")
    .select("*")
    .eq("invite_token", params.token)
    .single();

  if (error || !comp) {
    console.error("Join route: competition lookup failed", error);
    return NextResponse.redirect(new URL("/?err=bad-invite", req.url));
  }

  // ── Pool competition join ─────────────────────────────────────────────
  if (comp.format === "pool") {
    // Creator clicking their own link — just take them to the competition.
    if (comp.creator_id === user.id) {
      return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
    }

    // Use admin for ALL competition_members queries — the self-referential RLS
    // SELECT policy blocks the regular client from reading rows even when the
    // user IS a member, which would cause duplicate join attempts and bypass the
    // max_members cap.
    const admin = createSupabaseAdminClient();

    // Check if already a member.
    const { data: existing } = await admin
      .from("competition_members")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
    }

    // Check max_members cap.
    if (comp.max_members) {
      const { count } = await admin
        .from("competition_members")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", comp.id);

      if (count !== null && count >= comp.max_members) {
        return NextResponse.redirect(new URL("/?err=full", req.url));
      }
    }
    const { error: insertError } = await admin
      .from("competition_members")
      .insert({ competition_id: comp.id, user_id: user.id });

    if (insertError) {
      console.error("Join route: failed to insert pool member", insertError);
      return NextResponse.redirect(new URL("/?err=join-failed", req.url));
    }

    // Activate pool when first non-creator member joins.
    if (comp.status === "pending") {
      await admin
        .from("competitions")
        .update({ status: "active" })
        .eq("id", comp.id);
    }

    // Notify creator.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", [comp.creator_id, user.id]);

    const creatorProfile = profiles?.find((p) => p.id === comp.creator_id);
    const joinerProfile  = profiles?.find((p) => p.id === user.id);

    if (creatorProfile?.email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";
      const { subject, html } = opponentJoinedEmail({
        toName: creatorProfile.display_name ?? creatorProfile.email,
        opponentName: joinerProfile?.display_name ?? "Someone",
        competitionName: comp.name,
        competitionUrl: `${siteUrl}/competitions/${comp.id}`,
        sport: comp.sport ?? "NHL",
      });
      sendEmail({ to: creatorProfile.email, subject, html }).catch(console.error);
    }

    return NextResponse.redirect(new URL(`/competitions/${comp.id}?joined=1`, req.url));
  }

  // ── Survivor competition join ─────────────────────────────────────────
  if (comp.format === "survivor") {
    if (comp.creator_id === user.id) {
      return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
    }

    // Use admin for member checks — same self-referential RLS issue as pool.
    const admin = createSupabaseAdminClient();

    // Already a member?
    const { data: existing } = await admin
      .from("competition_members")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
    }

    // Competition still accepting members?
    if (comp.status === "cancelled" || comp.status === "complete") {
      return NextResponse.redirect(new URL("/?err=full", req.url));
    }
    const { error: insertError } = await admin
      .from("competition_members")
      .insert({
        competition_id:  comp.id,
        user_id:         user.id,
        survivor_status: "alive",
      });

    if (insertError) {
      console.error("Join route: failed to insert survivor member", insertError);
      return NextResponse.redirect(new URL("/?err=join-failed", req.url));
    }

    // Activate when first non-creator joins
    if (comp.status === "pending") {
      await admin
        .from("competitions")
        .update({ status: "active" })
        .eq("id", comp.id);
    }

    // Notify creator
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", [comp.creator_id, user.id]);

    const creatorProfile = profiles?.find((p) => p.id === comp.creator_id);
    const joinerProfile  = profiles?.find((p) => p.id === user.id);

    if (creatorProfile?.email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";
      const { subject, html } = opponentJoinedEmail({
        toName:          creatorProfile.display_name ?? creatorProfile.email,
        opponentName:    joinerProfile?.display_name ?? "Someone",
        competitionName: comp.name,
        competitionUrl:  `${siteUrl}/competitions/${comp.id}`,
        sport: "NFL",
      });
      sendEmail({ to: creatorProfile.email, subject, html }).catch(console.error);
    }

    return NextResponse.redirect(new URL(`/competitions/${comp.id}?joined=1`, req.url));
  }

  // ── 1v1 competition join (original logic) ─────────────────────────────

  // Creator clicking their own link — just take them to the competition.
  if (comp.creator_id === user.id) {
    return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
  }

  // Already joined as the opponent — just take them there.
  if (comp.opponent_id === user.id) {
    return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
  }

  // Someone else already joined — competition is full.
  if (comp.opponent_id && comp.opponent_id !== user.id) {
    return NextResponse.redirect(new URL("/?err=full", req.url));
  }

  // Join the competition — use admin client to bypass RLS since the
  // user isn't a participant yet and can't update their own entry.
  const admin = createSupabaseAdminClient();
  const { error: updateError } = await admin
    .from("competitions")
    .update({ opponent_id: user.id, status: "active" })
    .eq("id", comp.id);

  if (updateError) {
    console.error("Join route: failed to update competition", updateError);
    return NextResponse.redirect(new URL("/?err=join-failed", req.url));
  }

  // ── Notify the creator that their opponent has joined ─────────────────
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .in("id", [comp.creator_id, user.id]);

  const creatorProfile = profiles?.find((p) => p.id === comp.creator_id);
  const opponentProfile = profiles?.find((p) => p.id === user.id);

  if (creatorProfile?.email) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";
    const { subject, html } = opponentJoinedEmail({
      toName: creatorProfile.display_name ?? creatorProfile.email,
      opponentName: opponentProfile?.display_name ?? "Your opponent",
      competitionName: comp.name,
      competitionUrl: `${siteUrl}/competitions/${comp.id}`,
      sport: comp.sport ?? "NHL",
    });
    sendEmail({ to: creatorProfile.email, subject, html }).catch(console.error);
  }

  return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
}
