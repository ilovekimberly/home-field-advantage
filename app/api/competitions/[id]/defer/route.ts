import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateDraftOrder, whoPicksFirst, type Player } from "@/lib/picks";

// POST /api/competitions/:id/defer
// Body: { gameDate, deferred: boolean }
// Only the better-record first picker can call this, and only before any
// picks have been made for the given date.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { gameDate, deferred } = await req.json();
  if (!gameDate || deferred === undefined) {
    return NextResponse.json({ error: "gameDate and deferred required" }, { status: 400 });
  }

  const { data: comp } = await supabase
    .from("competitions").select("*").eq("id", params.id).single();
  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.id !== comp.creator_id && user.id !== comp.opponent_id)
    return NextResponse.json({ error: "not a participant" }, { status: 403 });

  // Only available for weekly/season competitions where records matter.
  if (comp.duration === "daily") {
    return NextResponse.json({ error: "defer is not available for daily competitions" }, { status: 400 });
  }

  // Ensure no picks have been made yet today.
  const { data: todaysPicks } = await supabase
    .from("picks")
    .select("id")
    .eq("competition_id", comp.id)
    .eq("game_date", gameDate);
  if (todaysPicks && todaysPicks.length > 0) {
    return NextResponse.json({ error: "picks already started for this date" }, { status: 409 });
  }

  // Verify this user is actually the first picker today.
  const { data: allPicks } = await supabase
    .from("picks").select("*").eq("competition_id", comp.id);

  const recordA = { wins: 0, losses: 0, pushes: 0 };
  const recordB = { wins: 0, losses: 0, pushes: 0 };
  for (const p of allPicks ?? []) {
    if (p.game_date >= gameDate) continue;
    const rec = p.picker_id === comp.creator_id ? recordA : recordB;
    if (p.result === "win") rec.wins++;
    else if (p.result === "loss") rec.losses++;
    else if (p.result === "push") rec.pushes++;
  }
  const prevDates = Array.from(new Set((allPicks ?? [])
    .filter((p) => p.game_date < gameDate).map((p) => p.game_date))).sort();
  const prevDate = prevDates[prevDates.length - 1];
  let previousFirstPicker: Player | null = null;
  if (prevDate) {
    const fp = (allPicks ?? [])
      .filter((p) => p.game_date === prevDate)
      .sort((a, b) => a.pick_index - b.pick_index)[0];
    if (fp) previousFirstPicker = fp.picker_id === comp.creator_id ? "A" : "B";
  }
  const firstPickerSlot = whoPicksFirst(recordA, recordB, previousFirstPicker, "A");
  const firstPickerUserId = firstPickerSlot === "A" ? comp.creator_id : comp.opponent_id;

  if (firstPickerUserId !== user.id) {
    return NextResponse.json({ error: "only the first picker can set the defer choice" }, { status: 403 });
  }

  // Upsert the defer choice.
  const { error: upsertErr } = await supabase
    .from("draft_defers")
    .upsert({ competition_id: comp.id, game_date: gameDate, deferred, chosen_by: user.id },
             { onConflict: "competition_id,game_date" });

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, deferred });
}
