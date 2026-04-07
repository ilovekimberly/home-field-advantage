import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Not signed in — send them to login and remember where they were going.
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

  // Join the competition.
  const { error: updateError } = await supabase
    .from("competitions")
    .update({ opponent_id: user.id, status: "active" })
    .eq("id", comp.id);

  if (updateError) {
    console.error("Join route: failed to update competition", updateError);
    return NextResponse.redirect(new URL("/?err=join-failed", req.url));
  }

  return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
}
