import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame } from "@/lib/schedule";
import { fifaOutcome } from "@/lib/fifa";

// POST /api/competitions/:id/pool-picks
// Body: { gameDate, gameId, teamAbbrev, teamName, pickOutcome? }
// Pool format: every member picks every game independently — no draft order.
// pickOutcome is used for FIFA: "HOME" | "AWAY" | "DRAW"
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = await req.json();
  const { gameDate, gameId, teamAbbrev, teamName, pickOutcome } = body;

  // Load competition
  const { data: comp } = await supabase
    .from("competitions")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (comp.format !== "pool") return NextResponse.json({ error: "not a pool" }, { status: 400 });

  // Use admin client throughout — self-referential RLS on competition_members
  // causes the regular client to return empty results.
  const admin = createSupabaseAdminClient();

  // Check membership
  const { data: membership } = await admin
    .from("competition_members")
    .select("id")
    .eq("competition_id", comp.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "not a member" }, { status: 403 });

  // Fetch today's schedule
  const sport = comp.sport ?? "NHL";
  let games;
  try { games = await fetchScheduleForDate(sport, gameDate); }
  catch { return NextResponse.json({ error: "schedule API failed" }, { status: 502 }); }

  const game = games.find((g) => String(g.id) === String(gameId));
  if (!game) return NextResponse.json({ error: "game not in slate" }, { status: 400 });

  // Reject picks on games that have already started
  if (new Date(game.startTimeUTC) <= new Date()) {
    return NextResponse.json({ error: "game has already started" }, { status: 409 });
  }

  // Check for existing pick on this game by this user
  const { data: existing } = await supabase
    .from("picks")
    .select("id")
    .eq("competition_id", comp.id)
    .eq("game_date", gameDate)
    .eq("game_id", String(gameId))
    .eq("picker_id", user.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: "already picked" }, { status: 409 });

  // Determine result (usually pending unless the game is already final)
  let result = "pending";
  if (isFinalGame(game)) {
    if (sport === "FIFA") {
      const outcome = fifaOutcome(game);
      if (outcome == null) {
        result = "pending";
      } else {
        result = outcome === pickOutcome ? "win" : "loss";
      }
    } else {
      // Standard winner pick
      if (game.homeScore == null || game.awayScore == null) {
        result = "pending";
      } else if (game.homeScore === game.awayScore) {
        result = "push";
      } else {
        const winnerAbbrev = game.homeScore > game.awayScore
          ? game.homeTeam.abbrev
          : game.awayTeam.abbrev;
        result = winnerAbbrev === teamAbbrev ? "win" : "loss";
      }
    }
  }

  // Count existing picks for this user on this date (for pick_index)
  const { count: pickCount } = await supabase
    .from("picks")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", comp.id)
    .eq("game_date", gameDate)
    .eq("picker_id", user.id);

  const { error: insErr } = await admin.from("picks").insert({
    competition_id: comp.id,
    game_date: gameDate,
    game_id: String(gameId),
    picker_id: user.id,
    picked_team_abbrev: sport === "FIFA" ? (pickOutcome ?? teamAbbrev) : teamAbbrev,
    picked_team_name: teamName,
    pick_index: pickCount ?? 0,
    pick_type: "winner",
    result,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/competitions/:id/pool-picks
// Body: { gameDate, gameId }
// Allows a pool member to retract a pick on a game that hasn't started yet.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = await req.json();
  const { gameDate, gameId } = body;

  const { data: comp } = await supabase
    .from("competitions")
    .select("id, format, sport")
    .eq("id", params.id)
    .single();
  if (!comp || comp.format !== "pool") return NextResponse.json({ error: "not found" }, { status: 404 });

  // Fetch game to verify it hasn't started
  const sport = comp.sport ?? "NHL";
  let games;
  try { games = await fetchScheduleForDate(sport, gameDate); }
  catch { return NextResponse.json({ error: "schedule API failed" }, { status: 502 }); }

  const game = games.find((g) => String(g.id) === String(gameId));
  if (!game) return NextResponse.json({ error: "game not found" }, { status: 400 });
  if (new Date(game.startTimeUTC) <= new Date()) {
    return NextResponse.json({ error: "game has already started" }, { status: 409 });
  }

  // Use admin client — RLS on the picks table may block deletes for regular
  // users, causing a silent no-op that leaves the pick in place and then makes
  // the subsequent POST return 409 "already picked".
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("picks")
    .delete()
    .eq("competition_id", comp.id)
    .eq("game_date", gameDate)
    .eq("game_id", String(gameId))
    .eq("picker_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
