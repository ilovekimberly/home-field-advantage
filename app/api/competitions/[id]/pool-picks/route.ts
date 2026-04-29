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

  // Use admin client throughout — RLS blocks pool members (who are neither
  // creator nor opponent_id) from reading the competition row, and also
  // blocks deletes/inserts on picks for non-creator users.
  const admin = createSupabaseAdminClient();

  // Load competition
  const { data: comp } = await admin
    .from("competitions")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (comp.format !== "pool") return NextResponse.json({ error: "not a pool" }, { status: 400 });

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
  const { data: existing } = await admin
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

  // pick_index has a unique constraint on (competition_id, game_date, pick_index)
  // across ALL pickers — not just the current user. For pools, multiple members
  // pick the same games, so we must use the global max+1, not a per-user count.
  const { data: maxRow } = await admin
    .from("picks")
    .select("pick_index")
    .eq("competition_id", comp.id)
    .eq("game_date", gameDate)
    .order("pick_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pickIndex = maxRow != null ? maxRow.pick_index + 1 : 0;

  const { error: insErr } = await admin.from("picks").insert({
    competition_id: comp.id,
    game_date: gameDate,
    game_id: String(gameId),
    picker_id: user.id,
    picked_team_abbrev: sport === "FIFA" ? (pickOutcome ?? teamAbbrev) : teamAbbrev,
    picked_team_name: teamName,
    pick_index: pickIndex,
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
