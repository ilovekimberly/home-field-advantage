import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame, winnerAbbrevGame } from "@/lib/schedule";
import { generateDraftOrder, whoPicksFirst, type Player, type DraftStyle } from "@/lib/picks";
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
  const sport = comp.sport ?? "NHL";
  let games;
  try { games = await fetchScheduleForDate(sport, gameDate); }
  catch { return NextResponse.json({ error: "schedule API failed" }, { status: 502 }); }

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

  // Determine if the pick-priority player deferred tonight.
  // If picks have already been made, derive it from who actually picked first
  // (ground truth) rather than trusting the defer table, which avoids
  // mismatches when the defer state changed after picks were already placed.
  let deferred = false;
  if (todays.length > 0) {
    const firstPick = [...todays].sort((a, b) => a.pick_index - b.pick_index)[0];
    const firstPickSlot = firstPick.picker_id === comp.creator_id ? "A" : "B";
    // If the first actual pick was made by the non-priority player, A deferred.
    deferred = firstPickSlot !== firstPicker;
  } else {
    const { data: deferRow } = await supabase
      .from("draft_defers")
      .select("deferred")
      .eq("competition_id", comp.id)
      .eq("game_date", gameDate)
      .maybeSingle();
    deferred = deferRow?.deferred ?? false;
  }

  const draft = generateDraftOrder({
    numGames: games.length,
    firstPicker,
    deferred,
    draftStyle: (comp.draft_style ?? "standard") as DraftStyle,
  });

  if (todays.length !== pickIndex)
    return NextResponse.json({ error: "stale pick index" }, { status: 409 });
  if (pickIndex >= draft.order.length)
    return NextResponse.json({ error: "draft is complete" }, { status: 409 });

  const onTheClock = draft.order[pickIndex];
  const expectedUserId = onTheClock === "A" ? comp.creator_id : comp.opponent_id;
  if (expectedUserId !== user.id)
    return NextResponse.json({ error: "not your turn" }, { status: 403 });

  const game = games.find((g) => String(g.id) === String(gameId));
  if (!game) return NextResponse.json({ error: "game not in tonight's slate" }, { status: 400 });

  // Reject picks on games that have already started.
  if (new Date(game.startTimeUTC) <= new Date()) {
    return NextResponse.json({ error: "game has already started" }, { status: 409 });
  }

  let result = "pending";
  if (isFinalGame(game)) {
    const w = winnerAbbrevGame(game);
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
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

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
