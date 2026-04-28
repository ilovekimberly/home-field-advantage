import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/friends — list accepted friends + pending requests (sent and received)
export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: rows } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status, created_at")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  const peerIds = Array.from(new Set(
    (rows ?? []).map((r) => r.requester_id === user.id ? r.addressee_id : r.requester_id)
  ));
  const { data: profiles } = peerIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", peerIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const friends: any[]         = [];
  const sentRequests: any[]    = [];
  const receivedRequests: any[] = [];

  for (const row of rows ?? []) {
    const peerId  = row.requester_id === user.id ? row.addressee_id : row.requester_id;
    const profile = profileMap.get(peerId);
    const entry   = { id: row.id, userId: peerId, name: profile?.display_name ?? profile?.email ?? "User", status: row.status };

    if (row.status === "accepted") {
      friends.push(entry);
    } else if (row.requester_id === user.id) {
      sentRequests.push(entry);
    } else {
      receivedRequests.push(entry);
    }
  }

  return NextResponse.json({ friends, sentRequests, receivedRequests });
}

// POST /api/friends — send a friend request by email or display name
export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { query } = await req.json();
  if (!query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });

  const q = query.trim().toLowerCase();

  // Find matching profile by email or display_name (case-insensitive).
  const { data: matches } = await supabase
    .from("profiles")
    .select("id, display_name, email")
    .or(`email.ilike.${q},display_name.ilike.${q}`)
    .neq("id", user.id)
    .limit(5);

  if (!matches || matches.length === 0) {
    return NextResponse.json({ error: "No user found with that name or email." }, { status: 404 });
  }

  // For now, send to the first exact match; if multiple, return them for the UI to pick.
  const exact = matches.find(
    (m) => m.email?.toLowerCase() === q || m.display_name?.toLowerCase() === q
  ) ?? matches[0];

  // Check for existing friendship.
  const { data: existing } = await supabase
    .from("friendships")
    .select("id, status")
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${exact.id}),` +
      `and(requester_id.eq.${exact.id},addressee_id.eq.${user.id})`
    )
    .maybeSingle();

  if (existing) {
    const msg = existing.status === "accepted" ? "You're already friends." : "A request already exists.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const { error } = await supabase.from("friendships").insert({
    requester_id: user.id,
    addressee_id: exact.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, name: exact.display_name ?? exact.email });
}
