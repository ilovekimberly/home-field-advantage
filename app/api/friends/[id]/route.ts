import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// PATCH /api/friends/[id] — accept a friend request
export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", params.id)
    .eq("addressee_id", user.id); // can only accept requests addressed to you

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/friends/[id] — remove friend or decline/cancel request
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", params.id)
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
