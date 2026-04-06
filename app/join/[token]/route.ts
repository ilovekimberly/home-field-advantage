import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /join/:token  -> joins competition and redirects to it.
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Remember where they were going so we can send them back after sign-in.
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `/join/${params.token}`);
    return NextResponse.redirect(loginUrl);
  }
  const { data: comp } = await supabase
    .from("competitions").select("*").eq("invite_token", params.token).single();
  if (!comp) {
    return NextResponse.redirect(new URL("/?err=bad-invite", req.url));
  }
  if (comp.creator_id === user.id) {
    return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
  }
  if (!comp.opponent_id) {
    await supabase
      .from("competitions")
      .update({ opponent_id: user.id, status: "active" })
      .eq("id", comp.id);
  } else if (comp.opponent_id !== user.id) {
    return NextResponse.redirect(new URL("/?err=full", req.url));
  }
  return NextResponse.redirect(new URL(`/competitions/${comp.id}`, req.url));
}
