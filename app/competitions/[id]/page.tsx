import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchScheduleForDate, isFinalGame, winnerAbbrevGame, getPickDate } from "@/lib/schedule";
import { fetchMLBTeamStats, type MLBTeamStatsMap } from "@/lib/mlb";
import { generateDraftOrder, whoPicksFirst, type Player } from "@/lib/picks";
import PickRoom from "./PickRoom";
import PoolPickRoom from "./PoolPickRoom";
import PoolLeaderboard from "./PoolLeaderboard";
import PoolWelcomeBanner from "./PoolWelcomeBanner";
import InvitePanel from "./InvitePanel";
import DeferBanner from "./DeferBanner";
import RefreshScores from "./RefreshScores";
import DateNav from "./DateNav";
import NightlyRecap from "./NightlyRecap";
import LiveStandings from "./LiveStandings";
import NightByNight, { type NightEntry } from "./NightByNight";

// Use Eastern Time so the date doesn't flip at midnight UTC while US games
// are still in progress (e.g. 8 PM ET = midnight UTC = "tomorrow" in UTC).
function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { date?: string; joined?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: comp } = await supabase
    .from("competitions").select("*").eq("id", params.id).single();
  if (!comp) notFound();

  const isPool = comp.format === "pool";
  const isCreator = comp.creator_id === user.id;
  const isOpponent = comp.opponent_id === user.id;

  // For pool competitions, also check competition_members table.
  let isPoolMember = false;
  if (isPool) {
    const { data: membership } = await supabase
      .from("competition_members")
      .select("id")
      .eq("competition_id", comp.id)
      .eq("user_id", user.id)
      .maybeSingle();
    isPoolMember = !!membership;
  }

  if (!isCreator && !isOpponent && !isPoolMember) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">Not a participant</h1>
        <p>You're not part of this competition. If you have an invite link, open it to join.</p>
      </div>
    );
  }

  // Profiles — for pools, load all members; for 1v1, just the two players.
  let poolMembers: { userId: string; name: string; wins: number; losses: number; pushes: number; isMe: boolean }[] = [];

  const ids = isPool
    ? [] // we'll load member profiles separately
    : [comp.creator_id, comp.opponent_id].filter(Boolean);

  let profiles: any[] | null = null;
  if (!isPool) {
    const { data } = await supabase.from("profiles").select("*").in("id", ids);
    profiles = data;
  }

  const creatorProfile = profiles?.find((p: any) => p.id === comp.creator_id);
  const opponentProfile = profiles?.find((p: any) => p.id === comp.opponent_id);
  const myProfile = isCreator ? creatorProfile : opponentProfile;
  const theirProfile = isCreator ? opponentProfile : creatorProfile;
  const myName = isPool ? "You" : (myProfile?.display_name ?? "You");
  const theirName = theirProfile?.display_name ?? "Opponent";

  const today = todayISO();

  // Fetch all picks first — needed to compute todayPickable before activeDate.
  const { data: allPicks } = await supabase
    .from("picks").select("*").eq("competition_id", comp.id);

  const datesWithPicks = Array.from(new Set((allPicks ?? []).map((p) => p.game_date))).sort();

  // Pool: load member list + their records for the leaderboard.
  if (isPool) {
    const { data: memberRows } = await supabase
      .from("competition_members")
      .select("user_id")
      .eq("competition_id", comp.id);

    const memberIds = (memberRows ?? []).map((r: any) => r.user_id);
    const { data: memberProfiles } = memberIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", memberIds)
      : { data: [] };

    for (const memberId of memberIds) {
      const memberPicks = (allPicks ?? []).filter((p) => p.picker_id === memberId);
      const profile = (memberProfiles ?? []).find((pr: any) => pr.id === memberId);
      poolMembers.push({
        userId: memberId,
        name: profile?.display_name ?? "Member",
        wins:   memberPicks.filter((p) => p.result === "win").length,
        losses: memberPicks.filter((p) => p.result === "loss").length,
        pushes: memberPicks.filter((p) => p.result === "push").length,
        isMe: memberId === user.id,
      });
    }
  }

  // Today is only accessible for picks if the most recent previous date has
  // no pending picks — i.e. yesterday's results are all in.
  const mostRecentPickDate = datesWithPicks.filter((d) => d < today).slice(-1)[0];
  // For pool competitions, everyone picks independently so we never block today
  // based on whether a previous date's picks are still pending.
  const prevDateHasPending = !isPool && mostRecentPickDate
    ? (allPicks ?? []).some(
        (p) =>
          p.game_date === mostRecentPickDate &&
          p.result === "pending" &&
          p.picker_id === user.id   // only MY pending picks gate today for 1v1
      )
    : false;
  const todayPickable = !prevDateHasPending;

  // Default active date (today clamped to comp window), overridable via ?date=
  // When today isn't pickable, snap the default back to the most recent pick date
  // so the page doesn't land on a locked "tonight" slot.
  const rawDefault =
    comp.duration === "daily" ? comp.start_date :
    today < comp.start_date ? comp.start_date :
    today > comp.end_date ? comp.end_date : today;

  const clampedDefault = !todayPickable && rawDefault === today
    ? (mostRecentPickDate ?? comp.start_date)
    : rawDefault;

  // For EPL, snap to gameweek start date.
  const defaultDate = getPickDate(comp.sport ?? "NHL", clampedDefault);

  const requestedDate = searchParams.date;
  const activeDate = requestedDate && requestedDate >= comp.start_date && requestedDate <= comp.end_date
    ? getPickDate(comp.sport ?? "NHL", requestedDate)
    : defaultDate;

  const isViewingToday = (activeDate === today || (comp.duration === "daily" && activeDate === comp.start_date))
    && todayPickable;

  const todaysPicks = (allPicks ?? []).filter((p) => p.game_date === activeDate);

  // Game lines for the active date (over/under + spread + moneyline)
  const needsLines = comp.enable_over_under || comp.enable_spread;
  const gameLineRows = needsLines
    ? (await supabase
        .from("game_lines")
        .select("game_id, total_line, over_odds, under_odds, home_ml, away_ml, home_spread, away_spread, home_spread_odds, away_spread_odds")
        .eq("game_date", activeDate)
      ).data ?? []
    : [];

  type GameLineData = {
    totalLine?: number | null;
    overOdds?: number | null;
    underOdds?: number | null;
    homeML?: number | null;
    awayML?: number | null;
    homeSpread?: number | null;
    awaySpread?: number | null;
    homeSpreadOdds?: number | null;
    awaySpreadOdds?: number | null;
  };
  const gameLines: Record<string, GameLineData> = {};
  for (const row of gameLineRows) {
    gameLines[String(row.game_id)] = {
      totalLine:      row.total_line,
      overOdds:       row.over_odds,
      underOdds:      row.under_odds,
      homeML:         row.home_ml,
      awayML:         row.away_ml,
      homeSpread:     row.home_spread,
      awaySpread:     row.away_spread,
      homeSpreadOdds: row.home_spread_odds,
      awaySpreadOdds: row.away_spread_odds,
    };
  }

  // Prior records (relative to activeDate)
  const recordA = { wins: 0, losses: 0, pushes: 0 };
  const recordB = { wins: 0, losses: 0, pushes: 0 };
  for (const p of allPicks ?? []) {
    if (p.game_date >= activeDate) continue;
    const rec = p.picker_id === comp.creator_id ? recordA : recordB;
    if (p.result === "win") rec.wins++;
    else if (p.result === "loss") rec.losses++;
    else if (p.result === "push") rec.pushes++;
  }

  // Previous date's first picker (tiebreaker)
  const prevDates = Array.from(new Set((allPicks ?? [])
    .filter((p) => p.game_date < activeDate)
    .map((p) => p.game_date))).sort();
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
  const firstPickerName = firstPickerSlot === "A"
    ? (creatorProfile?.display_name ?? "Creator")
    : (opponentProfile?.display_name ?? "Opponent");

  // Defer choice for activeDate
  const { data: deferRow } = await supabase
    .from("draft_defers")
    .select("deferred")
    .eq("competition_id", comp.id)
    .eq("game_date", activeDate)
    .maybeSingle();

  const deferChoiceMade = deferRow !== null;
  const deferred = deferRow?.deferred ?? false;

  // Schedule for activeDate
  let games: Awaited<ReturnType<typeof fetchScheduleForDate>> = [];
  try { games = await fetchScheduleForDate(comp.sport ?? "NHL", activeDate); } catch {}

  // MLB team stats (streak + last 10) — fetched once per page load, cached 1hr
  let mlbTeamStats: MLBTeamStatsMap = {};
  if (comp.sport === "MLB") {
    const season = activeDate.slice(0, 4);
    try { mlbTeamStats = await fetchMLBTeamStats(season); } catch {}
  }

  // Only count games that are either already picked or haven't started yet.
  // Games that started before anyone picked them are dropped from the slate.
  // Exception: doubleheader Game 2 IDs end with "-dh2" — the MLB API often
  // gives them the same start time as Game 1, so we never filter them by time.
  const now = new Date();
  const pickedGameIds = new Set(todaysPicks.map((p) => String(p.game_id)));
  const effectiveGameCount = games.filter(
    (g) =>
      String(g.id).endsWith("-dh2") ||
      pickedGameIds.has(String(g.id)) ||
      new Date(g.startTimeUTC) > now
  ).length;

  const draft = generateDraftOrder({
    numGames: effectiveGameCount,
    firstPicker: firstPickerSlot,
    deferred,
    draftStyle: (comp.draft_style ?? "standard") as "standard" | "balanced",
  });

  const showDeferBanner =
    isViewingToday &&
    !deferChoiceMade &&
    comp.duration !== "daily" &&
    effectiveGameCount > 3 &&
    todaysPicks.length === 0 &&
    firstPickerUserId === user.id &&
    !!comp.opponent_id;

  const opponentName = user.id === comp.creator_id
    ? (opponentProfile?.display_name ?? "Opponent")
    : (creatorProfile?.display_name ?? "Creator");

  // ── Nightly recap for the night before the activeDate ──────────────────
  // Only show for weekly/season comps where there's a previous night with picks.
  let nightlyRecap: {
    date: string; myWins: number; myLosses: number;
    theirWins: number; theirLosses: number;
    myName: string; theirName: string;
  } | null = null;

  if (comp.duration !== "daily" && prevDate && datesWithPicks.includes(prevDate)) {
    const prevPicks = (allPicks ?? []).filter((p) => p.game_date === prevDate);
    let myWins = 0, myLosses = 0, theirWins = 0, theirLosses = 0;
    for (const p of prevPicks) {
      const mine = p.picker_id === user.id;
      if (p.result === "win") mine ? myWins++ : theirWins++;
      if (p.result === "loss") mine ? myLosses++ : theirLosses++;
    }
    // Only show recap if there are scored picks (not all pending)
    if (myWins + myLosses + theirWins + theirLosses > 0) {
      nightlyRecap = { date: prevDate, myWins, myLosses, theirWins, theirLosses, myName, theirName };
    }
  }

  // ── Overall record for standings ───────────────────────────────────────
  const overallRecordA = { wins: 0, losses: 0, pushes: 0 };
  const overallRecordB = { wins: 0, losses: 0, pushes: 0 };
  for (const p of allPicks ?? []) {
    const rec = p.picker_id === comp.creator_id ? overallRecordA : overallRecordB;
    if (p.result === "win") rec.wins++;
    else if (p.result === "loss") rec.losses++;
    else if (p.result === "push") rec.pushes++;
  }

  // ── Night-by-night breakdown (weekly/season only) ──────────────────────
  const nightBreakdown: NightEntry[] = comp.duration !== "daily"
    ? datesWithPicks.map((date) => {
        const datePicks = (allPicks ?? []).filter((p) => p.game_date === date);
        let myWins = 0, myLosses = 0, theirWins = 0, theirLosses = 0;
        let hasPending = false;
        for (const p of datePicks) {
          const mine = p.picker_id === user.id;
          if (p.result === "win")     mine ? myWins++   : theirWins++;
          if (p.result === "loss")    mine ? myLosses++ : theirLosses++;
          if (p.result === "pending") hasPending = true;
        }
        return { date, myWins, myLosses, theirWins, theirLosses, hasPending };
      }).reverse() // most recent first
    : [];

  // ── Date score for the active date's header ────────────────────────────
  const myDateWins   = todaysPicks.filter((p) => p.picker_id === user.id && p.result === "win").length;
  const myDateLosses = todaysPicks.filter((p) => p.picker_id === user.id && p.result === "loss").length;
  const theirDateWins   = todaysPicks.filter((p) => p.picker_id !== user.id && p.result === "win").length;
  const theirDateLosses = todaysPicks.filter((p) => p.picker_id !== user.id && p.result === "loss").length;
  const dateScoreVisible = (myDateWins + myDateLosses + theirDateWins + theirDateLosses) > 0;

  return (
    <div className="space-y-6">
      {/* Competition header */}
      <div className="card">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold">{comp.name}</h1>
            <p className="text-sm text-slate-500">
              {comp.duration === "daily" ? "Single day" : comp.duration === "weekly" ? "1 week" : comp.duration === "playoff" ? "Playoffs" : "Full season"} · {comp.start_date} → {comp.end_date}
              {isPool && (
                <span className={`ml-2 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                  comp.max_members && poolMembers.length >= comp.max_members
                    ? "bg-amber-100 text-amber-700"
                    : "bg-rink/10 text-rink"
                }`}>
                  Pool · {comp.max_members
                    ? `${poolMembers.length}/${comp.max_members} members`
                    : `${poolMembers.length} member${poolMembers.length !== 1 ? "s" : ""}`}
                  {comp.max_members && poolMembers.length >= comp.max_members && " · Full"}
                </span>
              )}
            </p>
          </div>
          {!isPool && (
            <div className="text-right text-sm">
              <div><b>{creatorProfile?.display_name ?? "Creator"}</b> (creator)</div>
              <div>
                {opponentProfile?.display_name ??
                  <span className="italic text-slate-400">awaiting opponent…</span>}
              </div>
            </div>
          )}
        </div>
        {/* Invite panel: pool active creators can keep sharing; 1v1 only when no opponent yet */}
        {isCreator && ((isPool && comp.status === "active") || (!isPool && !comp.opponent_id)) && (
          <div className="mt-4">
            <InvitePanel
              competitionId={comp.id}
              inviteToken={comp.invite_token}
              siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""}
            />
          </div>
        )}
      </div>

      {/* Welcome banner — shown once to new members arriving via invite link */}
      {isPool && searchParams.joined === "1" && (
        <PoolWelcomeBanner sport={comp.sport ?? "NHL"} />
      )}

      {/* Pending pool banner — shown to all members while waiting for more to join */}
      {isPool && comp.status === "pending" && (
        <div className="card border-dashed border-2 border-rink/30 bg-rink/5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🏆</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 mb-0.5">
                {isCreator ? "Your pool is open — invite your group!" : "You're in! Waiting for more members."}
              </p>
              <p className="text-sm text-slate-500 mb-3">
                {comp.max_members
                  ? `${poolMembers.length} of ${comp.max_members} spots filled.`
                  : poolMembers.length === 1
                  ? "Only you so far."
                  : `${poolMembers.length} member${poolMembers.length !== 1 ? "s" : ""} joined so far.`}
                {" "}The pool activates once at least one other person joins.
                {comp.start_date > today && (
                  <> Picks open on <strong>{new Date(comp.start_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric" })}</strong>.</>
                )}
              </p>
              {isCreator && (
                <InvitePanel
                  competitionId={comp.id}
                  inviteToken={comp.invite_token}
                  siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""}
                />
              )}
              {!isCreator && (
                <p className="text-xs text-slate-400 italic">Ask the pool creator to share the invite link with others.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Standings at top when competition is complete */}
      {comp.status === "complete" && !isPool && (
        <LiveStandings
          competitionId={comp.id}
          playerAId={comp.creator_id}
          playerBId={comp.opponent_id ?? ""}
          nameA={creatorProfile?.display_name ?? "Creator"}
          nameB={opponentProfile?.display_name ?? "Opponent"}
          initialA={overallRecordA}
          initialB={overallRecordB}
        />
      )}
      {/* Pool leaderboard — shown for active/complete pool comps */}
      {isPool && comp.status !== "pending" && poolMembers.length > 0 && (
        <PoolLeaderboard
          competitionId={comp.id}
          currentUserId={user.id}
          initialMembers={poolMembers}
        />
      )}

      {/* Pick slate card — hidden for pending pools */}
      {!(isPool && comp.status === "pending") && <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-lg font-bold">
              {comp.sport === "EPL"
                ? `Gameweek · ${activeDate}`
                : new Date(activeDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </h2>
            {/* Per-date score — 1v1 only, shown once there are scored picks */}
            {!isPool && dateScoreVisible && (
              <p className="text-sm text-slate-500 mt-0.5 tabular-nums">
                <span className="font-medium text-slate-700">{myName}</span>{" "}
                <span className="font-semibold">{myDateWins}</span>
                <span className="text-slate-400">–{myDateLosses}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="font-medium text-slate-700">{theirName}</span>{" "}
                <span className="font-semibold">{theirDateWins}</span>
                <span className="text-slate-400">–{theirDateLosses}</span>
              </p>
            )}
          </div>
          {(isViewingToday || todaysPicks.some((p) => p.result === "pending")) && (
            <RefreshScores cronSecret={process.env.CRON_SECRET ?? ""} />
          )}
        </div>

        {/* Date navigator — only for weekly/season comps */}
        {comp.duration !== "daily" && (
          <DateNav
            competitionId={comp.id}
            activeDate={activeDate}
            startDate={comp.start_date}
            endDate={comp.end_date}
            datesWithPicks={datesWithPicks}
            todayPickable={todayPickable}
          />
        )}

        {/* Pending results banner — today locked until previous night is scored */}
        {!todayPickable && mostRecentPickDate && activeDate === mostRecentPickDate && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            ⏳ Results from tonight are still being scored — picks for tomorrow open once those are final.
          </div>
        )}

        {/* Nightly recap from the previous night */}
        {!isPool && nightlyRecap && isViewingToday && (
          <NightlyRecap night={nightlyRecap} />
        )}

        {/* Perfect night banner — shown when browsing a past date (1v1 only) */}
        {!isPool && !isViewingToday && todaysPicks.length > 0 && (() => {
          const scored = todaysPicks.filter((p) => p.result === "win" || p.result === "loss");
          const myScored = scored.filter((p) => p.picker_id === user.id);
          const theirScored = scored.filter((p) => p.picker_id !== user.id);
          const iPerfect = myScored.length > 0 && myScored.every((p) => p.result === "win");
          const theyPerfect = theirScored.length > 0 && theirScored.every((p) => p.result === "win");
          if (!iPerfect && !theyPerfect) return null;
          return (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
              <span className="text-xl">🔥</span>
              <span className="font-semibold">
                {iPerfect && theyPerfect
                  ? "Both players swept all picks this night!"
                  : iPerfect
                  ? "You swept all your picks this night!"
                  : `${theirName} swept all their picks this night!`}
              </span>
            </div>
          );
        })()}

        {isPool ? (
          <p className="text-sm text-slate-500 mb-4">
            {games.length} game{games.length !== 1 ? "s" : ""} · Pick all independently
          </p>
        ) : (
          <p className="text-sm text-slate-500 mb-4">
            {effectiveGameCount} games ·{" "}
            {deferChoiceMade
              ? <>first pick: <b>{firstPickerName}</b>{deferred ? " (deferred — takes picks #2 & #3)" : ""}</>
              : comp.duration === "daily" || !comp.opponent_id
                ? <>first pick: <b>{firstPickerName}</b></>
                : <><b>{firstPickerName}</b> has pick priority tonight</>}
            {draft.unpickedGames > 0 && <> · {draft.unpickedGames} game(s) left unpicked</>}
          </p>
        )}

        {!isPool && showDeferBanner && (
          <DeferBanner
            competitionId={comp.id}
            gameDate={activeDate}
            opponentName={opponentName}
          />
        )}

        {isPool && games.length === 0 && activeDate < today ? (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            No games were scheduled on this date.
          </div>
        ) : isPool && games.length === 0 ? (
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-6 text-center">
            <p className="text-sm font-medium text-blue-700 mb-1">No games scheduled yet</p>
            <p className="text-xs text-blue-500">
              The schedule for{" "}
              {new Date(activeDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric" })}{" "}
              hasn't been released. Check back closer to the tournament.
            </p>
          </div>
        ) : isPool ? (
          <PoolPickRoom
            competitionId={comp.id}
            activeDate={activeDate}
            games={games.map((g) => ({
              id: g.id,
              home: g.homeTeam,
              away: g.awayTeam,
              startTimeUTC: g.startTimeUTC,
              gameState: g.gameState,
              final: isFinalGame(g),
              winner: winnerAbbrevGame(g),
              homeScore: g.homeScore,
              awayScore: g.awayScore,
              period: g.period,
              periodType: g.periodType,
              clock: g.clock,
              inIntermission: g.inIntermission,
            }))}
            allDatePicks={todaysPicks}
            members={poolMembers.map((m) => ({ userId: m.userId, name: m.name }))}
            currentUserId={user.id}
            readOnly={!isViewingToday}
            sport={comp.sport ?? "NHL"}
          />
        ) : (
          <PickRoom
            competitionId={comp.id}
            activeDate={activeDate}
            games={games.map((g) => ({
              id: g.id,
              home: g.homeTeam,
              away: g.awayTeam,
              startTimeUTC: g.startTimeUTC,
              gameState: g.gameState,
              final: isFinalGame(g),
              winner: winnerAbbrevGame(g),
              homeScore: g.homeScore,
              awayScore: g.awayScore,
              period: g.period,
              periodType: g.periodType,
              clock: g.clock,
              inIntermission: g.inIntermission,
              gameNumber: g.gameNumber,
              homePitcher: g.homePitcher,
              awayPitcher: g.awayPitcher,
            }))}
            existingPicks={todaysPicks}
            draftOrder={draft.order}
            playerAId={comp.creator_id}
            playerBId={comp.opponent_id}
            playerAName={creatorProfile?.display_name ?? "Creator"}
            playerBName={opponentProfile?.display_name ?? "Opponent"}
            currentUserId={user.id}
            enableOverUnder={!!comp.enable_over_under}
            enableSpread={!!comp.enable_spread}
            gameLines={gameLines}
            sport={comp.sport ?? "NHL"}
            mlbTeamStats={mlbTeamStats}
            waitingForDefer={
              isViewingToday &&
              !deferChoiceMade &&
              todaysPicks.length === 0 &&
              comp.duration !== "daily" &&
              effectiveGameCount > 3 &&
              !!comp.opponent_id
            }
            readOnly={!isViewingToday}
          />
        )}
      </div>}

      {/* 1v1 Standings — always at bottom for active, moved to top for complete */}
      {!isPool && comp.status !== "complete" && (
        <LiveStandings
          competitionId={comp.id}
          playerAId={comp.creator_id}
          playerBId={comp.opponent_id ?? ""}
          nameA={creatorProfile?.display_name ?? "Creator"}
          nameB={opponentProfile?.display_name ?? "Opponent"}
          initialA={overallRecordA}
          initialB={overallRecordB}
        />
      )}

      {/* Night-by-night breakdown — weekly/season 1v1 comps only */}
      {!isPool && nightBreakdown.length > 0 && (
        <NightByNight
          competitionId={comp.id}
          nights={nightBreakdown}
          myName={myName}
          theirName={theirName}
          activeDate={activeDate}
        />
      )}
    </div>
  );
}

function Standings({ recordA, recordB, nameA, nameB }: any) {
  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-3">Overall standings</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b">
            <th className="pb-2">Player</th>
            <th className="pb-2">W</th>
            <th className="pb-2">L</th>
            <th className="pb-2">Pct</th>
          </tr>
        </thead>
        <tbody>
          {[
            { name: nameA, ...recordA },
            { name: nameB, ...recordB },
          ].map((row) => {
            const total = row.wins + row.losses;
            const pct = total === 0 ? "—" : (row.wins / total).toFixed(3).replace(/^0/, "");
            return (
              <tr key={row.name} className="border-b last:border-0">
                <td className="py-2 font-medium">{row.name}</td>
                <td className="py-2">{row.wins}</td>
                <td className="py-2">{row.losses}</td>
                <td className="py-2 text-slate-500">{pct}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
