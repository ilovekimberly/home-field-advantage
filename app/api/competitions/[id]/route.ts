import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

// PATCH /api/competitions/[id] — cancel a competition (creator only, no picks made yet)
export async function PATCH(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: comp } = await supabase
    .from("competitions")
    .select("id, creator_id, status")
    .eq("id", params.id)
    .eq("creator_id", user.id)
    .single();

  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (comp.status === "cancelled" || comp.status === "complete") {
    return NextResponse.json({ error: "already finished" }, { status: 409 });
  }

  // Block cancellation once any picks exist.
  const { count } = await supabase
    .from("picks")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", params.id);

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "picks have already been made" }, { status: 403 });
  }

  const { error } = await supabase
    .from("competitions")
    .update({ status: "cancelled" })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/competitions/[id]
// Only the creator can delete, and only cancelled competitions.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Verify competition exists, belongs to user, and is cancelled.
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, creator_id, status")
    .eq("id", params.id)
    .eq("creator_id", user.id)
    .single();

  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["cancelled", "pending"].includes(comp.status)) {
    return NextResponse.json({ error: "only cancelled or pending competitions can be deleted" }, { status: 403 });
  }

  // Use admin client to bypass RLS for cascading deletes.
  const admin = createSupabaseAdminClient();
  await admin.from("picks").delete().eq("competition_id", params.id);
  await admin.from("invites").delete().eq("competition_id", params.id);
  await admin.from("draft_defers").delete().eq("competition_id", params.id);
  await admin.from("competition_notifications").delete().eq("competition_id", params.id);
  const { error } = await admin.from("competitions").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
