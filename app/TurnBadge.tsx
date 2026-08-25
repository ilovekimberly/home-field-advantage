import { createSupabaseServerClient } from "@/lib/supabase/server";
import TurnBadgeDropdown from "./TurnBadgeDropdown";

// Server component — fetches which competitions need the user's attention
// (your turn to pick + pending friend requests) and passes them to the
// client dropdown component.

export default async function TurnBadge({ userId }: { userId: string }) {
  const supabase = createSupabaseServerClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Pending friend requests sent TO this user. Loaded first, and independently
  // of competitions — the bell has to render for a user with no active
  // competitions, otherwise friend requests are invisible. (This previously
  // sat after an early `return null` that hid the bell entirely.)
  const { data: friendRows } = await supabase
    .from("friendships")
    .select("id, requester_id")
    .eq("addressee_id", userId)
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
      name: (nameById.get(r.requester_id) as string) ?? "Someone",
    }));
  }

  // Active competitions the user is in, with today in the pick window.
  const { data: comps } = await supabase
    .from("competitions")
    .select("id, name, sport, creator_id, opponent_id")
    .eq("status", "active")
    .not("opponent_id", "is", null)
    .lte("start_date", today)
    .gte("end_date", today)
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`);

  if (!comps || comps.length === 0) {
    return <TurnBadgeDropdown competitions={[]} friendRequests={friendRequests} />;
  }

  const compIds = comps.map((c) => c.id);

  // Today's picks for those competitions, latest first.
  const { data: picks } = await supabase
    .from("picks")
    .select("competition_id, picker_id, pick_index")
    .in("competition_id", compIds)
    .eq("game_date", today)
    .order("pick_index", { ascending: false });

  // Check whether previous day has pending results (which locks today).
  const { data: pendingPicks } = await supabase
    .from("picks")
    .select("competition_id, result")
    .in("competition_id", compIds)
    .eq("result", "pending")
    .lt("game_date", today);

  const pendingCompIds = new Set((pendingPicks ?? []).map((p) => p.competition_id));

  // Build the list of competitions that need attention.
  const needsAttention: { id: string; name: string; sport: string }[] = [];

  for (const comp of comps) {
    if (pendingCompIds.has(comp.id)) continue;

    const compPicks = (picks ?? []).filter((p) => p.competition_id === comp.id);

    // No picks yet tonight — remind the first picker.
    if (compPicks.length === 0) {
      needsAttention.push({ id: comp.id, name: comp.name, sport: comp.sport ?? "NHL" });
      continue;
    }

    const myPicks    = compPicks.filter((p) => p.picker_id === userId);
    const theirPicks = compPicks.filter((p) => p.picker_id !== userId);

    // Only notify if the opponent has strictly more picks than me.
    // Equal counts means the draft is balanced (possibly complete) — no notification.
    // This prevents false "your turn" alerts at the end of a completed snake draft.
    if (myPicks.length < theirPicks.length) {
      needsAttention.push({ id: comp.id, name: comp.name, sport: comp.sport ?? "NHL" });
    }
  }

  return (
    <TurnBadgeDropdown
      competitions={needsAttention}
      friendRequests={friendRequests}
    />
  );
}
