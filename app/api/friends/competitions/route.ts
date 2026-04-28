import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/friends/competitions
// Returns active competitions visible to the current user from their friends.
// Used by the friends page and the home page feed.

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ compsByUser: {} });

  // Get accepted friends.
  const { data: friendships } = await supabase
    .from("friendships")
    .select("requester_id, addressee_id")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq("status", "accepted");

  const friendIds = (friendships ?? []).map((f) =>
    f.requester_id === user.id ? f.addressee_id : f.requester_id
  );

  if (friendIds.length === 0) return NextResponse.json({ compsByUser: {} });

  // Competitions where the friend is creator, visible to friends, and active/pending.
  const { data: comps } = await supabase
    .from("competitions")
    .select("id, name, sport, status, start_date, creator_id")
    .in("creator_id", friendIds)
    .eq("visibility", "friends")
    .in("status", ["active", "pending"])
    .order("start_date", { ascending: false });

  // Group by creator_id.
  const compsByUser: Record<string, any[]> = {};
  for (const comp of comps ?? []) {
    if (!compsByUser[comp.creator_id]) compsByUser[comp.creator_id] = [];
    compsByUser[comp.creator_id].push(comp);
  }

  return NextResponse.json({ compsByUser, friendIds });
}
