import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchNFLScoreboard, getNFLWeekLockTime } from "@/lib/nfl";
import { sendEmail, survivorKickoffRevealEmail } from "@/lib/email";

// GET /api/cron/notify-survivor
//
// Sends the Thursday kickoff "picks reveal" email to all alive survivors.
//
// Timing: runs every 30 min (or hourly) — checks if:
//   (a) The lock time has passed for the current NFL week
//   (b) The kickoff email hasn't been sent for this week yet
//   (c) At least one game is starting this week
//
// Uses competition_notifications to dedup (notification_type = "survivor_kickoff_reveal").

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const authHeader  = req.headers.get("authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  const querySecret = searchParams.get("secret");
  const secret      = process.env.CRON_SECRET;

  if (secret && bearerToken !== secret && querySecret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const supabase  = createSupabaseAdminClient();
  const siteUrl   = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";
  const today     = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Fetch current NFL week
  let weekInfo;
  let games;
  try {
    const result = await fetchNFLScoreboard();
    weekInfo = result.weekInfo;
    games    = result.games;
  } catch (e) {
    console.error("notify-survivor: NFL fetch failed", e);
    return NextResponse.json({ error: "NFL schedule fetch failed" }, { status: 503 });
  }

  if (!games.length) {
    return NextResponse.json({ skipped: true, reason: "No NFL games this week" });
  }

  // Check if lock time has passed
  const lockTime = getNFLWeekLockTime(games);
  if (!lockTime || new Date() < new Date(lockTime)) {
    return NextResponse.json({ skipped: true, reason: "Picks not locked yet" });
  }

  // Find active survivor competitions
  const { data: survivorComps } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("format", "survivor")
    .eq("status", "active");

  if (!survivorComps || survivorComps.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active survivor competitions" });
  }

  const notificationKey = `survivor_kickoff_reveal_week_${weekInfo.week}`;
  const results: Record<string, any> = {};
  let totalSent = 0;

  for (const comp of survivorComps) {
    const competitionUrl = `${siteUrl}/competitions/${comp.id}`;

    // Check if already sent for this week
    const { data: alreadySent } = await supabase
      .from("competition_notifications")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("notification_date", today)
      .eq("notification_type", notificationKey)
      .maybeSingle();

    if (alreadySent) {
      results[comp.id] = { skipped: true, reason: "Already sent this week" };
      continue;
    }

    // Get all members (alive + eliminated) for the picks reveal
    const { data: memberRows } = await supabase
      .from("competition_members")
      .select("user_id, survivor_status")
      .eq("competition_id", comp.id);

    if (!memberRows || memberRows.length === 0) {
      results[comp.id] = { skipped: true, reason: "No members" };
      continue;
    }

    const memberIds = memberRows.map((r: any) => r.user_id as string);

    // Load profiles
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", memberIds);

    const profileMap = new Map(
      (profiles ?? []).map((p: any) => [p.id as string, p])
    );

    // Load this week's picks for the reveal
    const { data: weekPicks } = await supabase
      .from("survivor_picks")
      .select("user_id, picked_team_abbrev, picked_team_name, result")
      .eq("competition_id", comp.id)
      .eq("week_number", weekInfo.week);

    const pickMap = new Map(
      (weekPicks ?? []).map((p: any) => [p.user_id as string, p])
    );

    // Build the picks reveal list
    const pickReveal = memberRows.map((row: any) => {
      const userId = row.user_id as string;
      const pick   = pickMap.get(userId);
      return {
        userId,
        name:       (profileMap.get(userId)?.display_name as string) ?? "Member",
        teamAbbrev: pick?.picked_team_abbrev as string ?? "–",
        teamName:   pick?.picked_team_name as string  ?? "No pick",
        status:     (row.survivor_status as "alive" | "eliminated") ?? "alive",
      };
    });

    // Send to all alive members
    const aliveRows = memberRows.filter(
      (r: any) => r.survivor_status === "alive"
    );
    let sent = 0;

    for (const row of aliveRows) {
      const profile = profileMap.get(row.user_id as string);
      if (!profile?.email) continue;

      const { subject, html } = survivorKickoffRevealEmail({
        toName:          (profile.display_name as string) ?? profile.email,
        competitionName: comp.name,
        competitionUrl,
        weekLabel:       weekInfo.label,
        picks:           pickReveal,
      });

      const ok = await sendEmail({ to: profile.email as string, subject, html });
      if (ok) sent++;
    }

    // Record notification sent
    await supabase
      .from("competition_notifications")
      .upsert(
        {
          competition_id:    comp.id,
          notification_date: today,
          notification_type: notificationKey,
        },
        { onConflict: "competition_id,notification_date,notification_type" }
      );

    results[comp.id] = { sent };
    totalSent += sent;
    console.log(`notify-survivor [${comp.id}]: sent ${sent} kickoff reveal emails for ${weekInfo.label}`);
  }

  return NextResponse.json({ totalSent, week: weekInfo.week, results });
}
