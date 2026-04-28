import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fetchScheduleForDate } from "@/lib/schedule";
import { sendEmail, poolPicksOpenEmail } from "@/lib/email";

// GET /api/cron/notify-pools
// Runs once daily at 2 PM UTC (9 AM ET) via cron-job.org.
//
// For every active pool competition with games today, sends a morning
// "picks are open" email to all members who haven't been notified yet.
// Uses the same competition_notifications dedup table as notify-1v1.

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

  const today    = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const supabase = createSupabaseAdminClient();
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL ?? "https://myhomefield.team";

  // Active pool competitions that have started and haven't ended.
  const { data: pools } = await supabase
    .from("competitions")
    .select("id, name, sport, start_date, end_date")
    .eq("status", "active")
    .eq("format", "pool")
    .lte("start_date", today)
    .gte("end_date", today);

  if (!pools || pools.length === 0) {
    return NextResponse.json({ skipped: true, reason: "No active pools today" });
  }

  // Check which pools already got notified today.
  const poolIds = pools.map((p) => p.id);
  const { data: alreadySent } = await supabase
    .from("competition_notifications")
    .select("competition_id")
    .in("competition_id", poolIds)
    .eq("notification_date", today)
    .eq("notification_type", "picks_open");
  const alreadySentIds = new Set((alreadySent ?? []).map((r) => r.competition_id));

  const eligible = pools.filter((p) => !alreadySentIds.has(p.id));
  if (eligible.length === 0) {
    return NextResponse.json({ skipped: true, reason: "All pools already notified today" });
  }

  // Group pools by sport — only notify if that sport has games today.
  const sportPools: Record<string, typeof eligible> = {};
  for (const pool of eligible) {
    const sport = pool.sport ?? "NHL";
    if (!sportPools[sport]) sportPools[sport] = [];
    sportPools[sport].push(pool);
  }

  // Pre-load all member user IDs.
  const { data: memberRows } = await supabase
    .from("competition_members")
    .select("competition_id, user_id")
    .in("competition_id", poolIds);

  // Pre-load all member profiles.
  const memberIds = Array.from(new Set((memberRows ?? []).map((r: any) => r.user_id)));
  const { data: profiles } = memberIds.length > 0
    ? await supabase.from("profiles").select("id, display_name, email").in("id", memberIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const results: Record<string, { sent: number; skipped: string | null }> = {};
  let totalSent = 0;

  for (const [sport, sportPoolList] of Object.entries(sportPools)) {
    // Check if this sport has games today.
    let games: any[];
    try {
      games = await fetchScheduleForDate(sport, today);
    } catch (e) {
      console.error(`notify-pools: ${sport} schedule failed`, e);
      results[sport] = { sent: 0, skipped: "schedule fetch failed" };
      continue;
    }

    if (!games || games.length === 0) {
      results[sport] = { sent: 0, skipped: "no games today" };
      continue;
    }

    let sportSent = 0;

    for (const pool of sportPoolList) {
      const members = (memberRows ?? [])
        .filter((r: any) => r.competition_id === pool.id)
        .map((r: any) => r.user_id);

      const competitionUrl = `${siteUrl}/competitions/${pool.id}`;

      for (const memberId of members) {
        const profile = profileMap.get(memberId);
        if (!profile?.email) continue;

        const { subject, html } = poolPicksOpenEmail({
          toName:          profile.display_name ?? profile.email,
          competitionName: pool.name,
          competitionUrl,
          sport:           pool.sport ?? "NHL",
          startDate:       today,
        });

        const ok = await sendEmail({ to: profile.email, subject, html });
        if (ok) sportSent++;
      }

      // Record notification sent for this pool today.
      await supabase.from("competition_notifications").upsert({
        competition_id:    pool.id,
        notification_date: today,
        notification_type: "picks_open",
      }, { onConflict: "competition_id,notification_date,notification_type" });

      console.log(`notify-pools [${sport}]: notified ${members.length} members of "${pool.name}"`);
    }

    results[sport] = { sent: sportSent, skipped: null };
    totalSent += sportSent;
  }

  return NextResponse.json({ totalSent, results });
}
