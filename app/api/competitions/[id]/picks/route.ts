import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchNHLScheduleForDate, isFinal, winnerAbbrev } from "@/lib/nhl";
import { generateDraftOrder, whoPicksFirst, type Player } from "@/lib/picks";
import { sendEmail, yourTurnEmail } from "@/lib/email";

// POST /api/competitions/:id/picks
// Body: { gameDate, gameId, teamAbbrev, teamName, pickIndex }
// Validates that it's the caller's turn before inserting, then notifies
// the other player by email that it's now their pick.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = await req.json();
  const { gameDate, gameId, teamAbbrev, teamName, pickIndex } = body;

  const { data: comp } = await supabase
    .from("competitions").select("*").eq("id", params.id).single();
  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.id !== comp.creator_id && user.id !== comp.opponent_id)
    return NextResponse.json({ error: "not a participant" }, { status: 403 });

  // Recompute draft order server-side to validate the turn.
  let games;
  try { games = await fetchNHLScheduleForDate(gameDate); }
  catch { return NextResponse.json({ error: "NHL API failed" }, { status: 502 }); }

  const { data: allPicks } = await supabase
    .from("picks").select("*").eq("competition_id", comp.id);
  const todays = (allPicks ?? []).filter((p) => p.game_date === gameDate);

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
  const firstPicker = whoPicksFirst(recordA, recordB, previousFirstPicker, "A");
  const draft = generateDraftOrder({ numGames: games.length, firstPicker, deferred: false });

  if (todays.length !== pickIndex)
    return NextResponse.json({ error: "stale pick index" }, { status: 409 });
  if (pickIndex >= draft.order.length)
    return NextResponse.json({ error: "draft is complete" }, { status: 409 });

  const onTheClock = draft.order[pickIndex];
  const expectedUserId = onTheClock === "A" ? comp.creator_id : comp.opponent_id;
  if (expectedUserId !== user.id)
    return NextResponse.json({ error: "not your turn" }, { status: 403 });

  const game = games.find((g) => g.id === gameId);
  if (!game) return NextResponse.json({ error: "game not in tonight's slate" }, { status: 400 });

  let result = "pending";
  if (isFinal(game.gameState)) {
    const w = winnerAbbrev(game);
    if (w == null) result = "push";
    else result = w === teamAbbrev ? "win" : "loss";
  }

  const { error: insErr } = await supabase.from("picks").insert({
    competition_id: comp.id,
    game_date: gameDate,
    game_id: gameId,
    picker_id: user.id,
    picked_team_abbrev: teamAbbrev,
    picked_team_name: teamName,
    pick_index: pickIndex,
    result,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  // ── Send "your turn" email to the next picker ─────────────────────────
  const nextPickIndex = pickIndex + 1;
  const draftDone = nextPickIndex >= draft.order.length;

  if (!draftDone) {
    const nextSlot = draft.order[nextPickIndex];
    const nextPickerId = nextSlot === "A" ? comp.creator_id : comp.opponent_id;

    // Only email if it's the OTHER player's turn (no need to email the same
    // player when they have back-to-back picks like positions 1&2 or 2&3).
    if (nextPickerId !== user.id) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", [user.id, nextPickerId]);

      const currentProfile = profiles?.find((p) => p.id === user.id);
      const nextProfile = profiles?.find((p) => p.id === nextPickerId);

      if (nextProfile?.email) {
        const picksAlreadyMade = todays.length + 1; // include the one just saved
        const gamesRemaining = draft.order.length - picksAlreadyMade;
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://home-field-advantage.vercel.app";

        const { subject, html } = yourTurnEmail({
          toName: nextProfile.display_name ?? nextProfile.email,
          opponentName: currentProfile?.display_name ?? "Your opponent",
          competitionName: comp.name,
          competitionUrl: `${siteUrl}/competitions/${comp.id}`,
          gamesRemaining,
          pickNumber: picksAlreadyMade + 1,
        });

        // Fire and forget — don't block the pick response on email delivery.
        sendEmail({ to: nextProfile.email, subject, html }).catch(console.error);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
