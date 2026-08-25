import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/notifications/turn
// Returns the competitions where the current user needs to pick today,
// plus any pending friend requests.
// Called client-side by TurnBadgeDropdown so the badge refreshes without
// a full page reload (root layout server components don't re-render on
// router.refresh()).

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ competitions: [], friendRequests: [] });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Pending friend requests sent TO the current user. Loaded first and
  // independently of competitions — a user with no active competitions still
  // needs to see friend requests. (This used to sit after an early return
  // that fired when there were no competitions, so the badge never appeared.)
  const { data: friendRows } = await supabase
    .from("friendships")
    .select("id, requester_id")
    .eq("addressee_id", user.id)
    .eq("status", "pending");

  const requesterIds = (friendRows ?? []).map((r) => r.requester_id);
  let friendRequests: { id: string; name: string }[] = [];
  if (requesterIds.length > 0) {
    const { data: requesterProfiles } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", requesterIds);
    const nameById = new Map(
      (requesterProfiles ?? []).map((p) => [p.id, p.display_name ?? p.email ?? "Someone"])
    );
    friendRequests = (friendRows ?? []).map((r) => ({
      id: r.id,
      name: nameById.get(r.requester_id) ?? "Someone",
    }));
  }

  const { data: comps } = await supabase
    .from("competitions")
    .select("id, name, sport, creator_id, opponent_id")
    .eq("status", "active")
    .not("opponent_id", "is", null)
    .lte("start_date", today)
    .gte("end_date", today)
    .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`);

  if (!comps || comps.length === 0) {
    return NextResponse.json({ competitions: [], friendRequests });
  }

  const compIds = comps.map((c) => c.id);

  const { data: picks } = await supabase
    .from("picks")
    .select("competition_id, picker_id, pick_index")
    .in("competition_id", compIds)
    .eq("game_date", today)
    .order("pick_index", { ascending: false });

  const { data: pendingPicks } = await supabase
    .from("picks")
    .select("competition_id, result")
    .in("competition_id", compIds)
    .eq("result", "pending")
    .lt("game_date", today);

  const pendingCompIds = new Set((pendingPicks ?? []).map((p) => p.competition_id));

  const needsAttention: { id: string; name: string; sport: string }[] = [];

  for (const comp of comps) {
    if (pendingCompIds.has(comp.id)) continue;

    const compPicks = (picks ?? []).filter((p) => p.competition_id === comp.id);

    if (compPicks.length === 0) {
      needsAttention.push({ id: comp.id, name: comp.name, sport: comp.sport ?? "NHL" });
      continue;
    }

    const myPicks    = compPicks.filter((p) => p.picker_id === user.id);
    const theirPicks = compPicks.filter((p) => p.picker_id !== user.id);

    if (myPicks.length < theirPicks.length) {
      needsAttention.push({ id: comp.id, name: comp.name, sport: comp.sport ?? "NHL" });
    }
  }

  return NextResponse.json({ competitions: needsAttention, friendRequests });
}
