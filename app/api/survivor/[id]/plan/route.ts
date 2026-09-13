import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNFLSeasonGrid } from "@/lib/nfl";

// Survivor pick planning — PRIVATE to the requesting user.
//
// Every query here is scoped to user_id from the session, never from the
// request body, so one member can't read or write another's plan.

async function loadContext(competitionId: string) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauth" }, { status: 401 }) };

  const admin = createSupabaseAdminClient();
  const { data: comp } = await admin
    .from("competitions")
    .select("id, format, sport")
    .eq("id", competitionId)
    .single();

  if (!comp || comp.format !== "survivor") {
    return { error: NextResponse.json({ error: "Not a survivor competition" }, { status: 400 }) };
  }

  const { data: membership } = await admin
    .from("competition_members")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return { error: NextResponse.json({ error: "Not a member" }, { status: 403 }) };
  }

  return { user, admin };
}

// GET /api/survivor/:id/plan
// Returns the caller's plan plus the season grid and their used teams.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await loadContext(params.id);
  if (ctx.error) return ctx.error;
  const { user, admin } = ctx;

  const grid = await fetchNFLSeasonGrid().catch(() => null);
  if (!grid) {
    return NextResponse.json({ error: "Schedule unavailable" }, { status: 502 });
  }

  const [{ data: plans }, { data: picks }] = await Promise.all([
    admin
      .from("survivor_plans")
      .select("week_number, team_abbrev, auto_submit")
      .eq("competition_id", params.id)
      .eq("user_id", user!.id),
    admin
      .from("survivor_picks")
      .select("week_number, team_abbrev, result")
      .eq("competition_id", params.id)
      .eq("user_id", user!.id),
  ]);

  return NextResponse.json({
    grid,
    plan: plans ?? [],
    // Committed picks — these teams are spent and can't be planned again.
    picks: picks ?? [],
  });
}

// PUT /api/survivor/:id/plan
// Body: { weekNumber, teamAbbrev, autoSubmit? }
// Upserts one week of the caller's plan.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const ctx = await loadContext(params.id);
  if (ctx.error) return ctx.error;
  const { user, admin } = ctx;

  const body = await req.json().catch(() => ({}));
  const weekNumber = Number(body.weekNumber);
  const teamAbbrev = typeof body.teamAbbrev === "string" ? body.teamAbbrev.trim() : "";
  const autoSubmit = body.autoSubmit === true;

  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
    return NextResponse.json({ error: "weekNumber must be 1-18" }, { status: 400 });
  }
  if (!teamAbbrev) {
    return NextResponse.json({ error: "teamAbbrev required" }, { status: 400 });
  }

  // A team already committed in a real pick can't be planned again — survivor
  // allows each team only once per season.
  const { data: usedPicks } = await admin
    .from("survivor_picks")
    .select("week_number, team_abbrev")
    .eq("competition_id", params.id)
    .eq("user_id", user!.id);

  const committed = (usedPicks ?? []).find(
    (p: any) => p.team_abbrev === teamAbbrev && p.week_number !== weekNumber
  );
  if (committed) {
    return NextResponse.json(
      { error: `You already used ${teamAbbrev} in week ${committed.week_number}` },
      { status: 400 }
    );
  }

  // Same rule within the plan itself — planning one team twice is always a
  // mistake, so clear the earlier slot rather than silently allowing it.
  await admin
    .from("survivor_plans")
    .delete()
    .eq("competition_id", params.id)
    .eq("user_id", user!.id)
    .eq("team_abbrev", teamAbbrev)
    .neq("week_number", weekNumber);

  // season_year mirrors survivor_picks so both tables agree.
  const now = new Date();
  const seasonYear = now.getUTCMonth() + 1 >= 3
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;

  const { error } = await admin.from("survivor_plans").upsert(
    {
      competition_id: params.id,
      user_id:        user!.id,
      season_year:    seasonYear,
      week_number:    weekNumber,
      team_abbrev:    teamAbbrev,
      auto_submit:    autoSubmit,
      updated_at:     now.toISOString(),
    },
    { onConflict: "competition_id,user_id,week_number" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/survivor/:id/plan
// Body: { weekNumber } — clears that week from the caller's plan.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await loadContext(params.id);
  if (ctx.error) return ctx.error;
  const { user, admin } = ctx;

  const body = await req.json().catch(() => ({}));
  const weekNumber = Number(body.weekNumber);
  if (!Number.isInteger(weekNumber)) {
    return NextResponse.json({ error: "weekNumber required" }, { status: 400 });
  }

  const { error } = await admin
    .from("survivor_plans")
    .delete()
    .eq("competition_id", params.id)
    .eq("user_id", user!.id)
    .eq("week_number", weekNumber);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
