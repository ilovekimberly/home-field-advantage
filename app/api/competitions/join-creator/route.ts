import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

// POST /api/competitions/join-creator
// Body: { competitionId, survivorStatus: "alive" | null }
//
// Auto-joins the authenticated user (creator) as the first member of a pool
// or survivor competition. Uses the admin client to bypass RLS.
// Called from the new competition page immediately after creating the competition.

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { competitionId, survivorStatus } = await req.json();
  if (!competitionId) {
    return NextResponse.json({ error: "competitionId required" }, { status: 400 });
  }

  // Verify the caller is actually the creator.
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, creator_id, format")
    .eq("id", competitionId)
    .eq("creator_id", user.id)
    .single();

  if (!comp) {
    return NextResponse.json({ error: "competition not found or not yours" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("competition_members").insert({
    competition_id: competitionId,
    user_id: user.id,
    survivor_status: survivorStatus ?? null,
  });

  if (error) {
    console.error("join-creator: insert failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
