import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  if (comp.status !== "cancelled") {
    return NextResponse.json({ error: "only cancelled competitions can be deleted" }, { status: 403 });
  }

  // Delete related records first, then the competition.
  await supabase.from("picks").delete().eq("competition_id", params.id);
  await supabase.from("invites").delete().eq("competition_id", params.id);
  await supabase.from("draft_defers").delete().eq("competition_id", params.id);
  await supabase.from("competition_notifications").delete().eq("competition_id", params.id);
  await supabase.from("competitions").delete().eq("id", params.id);

  return NextResponse.json({ ok: true });
}
