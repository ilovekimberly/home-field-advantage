// =====================================================================
// Pick'em draft order generator.
//
// Rules (1v1 NHL pick'em as specified by the product owner):
//
//  1. For DAILY competitions, the creator picks first on day 1.
//     For WEEKLY / SEASON competitions, the player with the better record
//     across PRIOR dates picks first. Ties go to whoever did NOT pick first
//     on the previous date (alternating fallback). On day 1 the creator
//     picks first.
//  2. The first picker can either:
//        (a) take the very first pick of the day, or
//        (b) DEFER and instead take picks #2 AND #3.
//     If they defer, the other player takes pick #1.
//  3. After pick #3 the picks alternate normally...
//  4. ...until you reach the 3rd-to-last and 2nd-to-last picks of the day.
//     Whoever made the very FIRST pick of the day takes BOTH of those, and
//     the other player takes the very last pick. (This mirrors the start
//     rule and keeps the totals balanced for any even number of picks.)
//  5. If the night has an ODD number of games, one game is left unpicked
//     (drop the last game from the draft so total picks is even).
//  6. If the night has 3 or fewer games, each player picks exactly ONE
//     game (so 2 picks total, the rest are left unpicked). With 1 game,
//     only the first picker picks.
//
// The end-rule (#4) and the start-rule (#2) only fit cleanly when there
// are at least 6 picks. When there would be 4 picks the rules collide;
// in that case we apply only the start rule and then alternate, which
// keeps each player at 2 picks.
// =====================================================================

export type Player = "A" | "B";

export type DraftInputs = {
  numGames: number;
  /** "A" = the player who has the better record (or creator on day 1) */
  firstPicker: Player;
  /** true if the better-record player chose to defer (take picks 2 & 3) */
  deferred: boolean;
};

export type DraftResult = {
  /** Order of picks. order[i] is the player who makes the (i+1)-th pick. */
  order: Player[];
  /** Number of games that go unpicked tonight. */
  unpickedGames: number;
};

export function generateDraftOrder(input: DraftInputs): DraftResult {
  const { numGames, firstPicker, deferred } = input;
  const A: Player = firstPicker;
  const B: Player = firstPicker === "A" ? "B" : "A";

  // --- 3-or-fewer-games special case ---
  if (numGames <= 3) {
    if (numGames <= 0) return { order: [], unpickedGames: 0 };
    if (numGames === 1) return { order: [A], unpickedGames: 0 };
    // 2 or 3 games -> each player picks 1; with 3 games one is left unpicked.
    const order: Player[] = deferred ? [B, A] : [A, B];
    return { order, unpickedGames: numGames - 2 };
  }

  // --- normal flow ---
  // Drop the last game if odd so totalPicks is even.
  const totalPicks = numGames % 2 === 0 ? numGames : numGames - 1;
  const unpickedGames = numGames - totalPicks;

  // Start rule: pick #1 + the bundled pair (picks 2 & 3).
  // If A defers, B picks first and A gets picks 2 and 3.
  let order: Player[];
  if (deferred) order = [B, A, A];
  else order = [A, B, B];

  // Alternate from pick #4 onward, starting with whoever did NOT take pick 3.
  let next: Player = order[2] === A ? B : A;
  while (order.length < totalPicks) {
    order.push(next);
    next = next === A ? B : A;
  }

  // End rule: if there's room for it (>=6 picks total), force the last 3
  // picks to "first-overall, first-overall, second-overall".
  if (totalPicks >= 6) {
    const firstOverall = order[0];
    const secondOverall = firstOverall === A ? B : A;
    order[totalPicks - 3] = firstOverall;
    order[totalPicks - 2] = firstOverall;
    order[totalPicks - 1] = secondOverall;
  }

  return { order, unpickedGames };
}

// =====================================================================
// Determining who picks first on a given date based on prior records.
// =====================================================================

export type Record = { wins: number; losses: number; pushes: number };

/**
 * Returns 'A' or 'B' indicating who has the better PRIOR record.
 * Tiebreaker: whoever did NOT pick first on the previous date. On the very
 * first date of a competition, the creator (passed in as defaultFirst) picks.
 */
export function whoPicksFirst(
  recordA: Record,
  recordB: Record,
  previousFirstPicker: Player | null,
  defaultFirst: Player
): Player {
  const winsA = recordA.wins, winsB = recordB.wins;
  if (winsA !== winsB) return winsA > winsB ? "A" : "B";
  const lossesA = recordA.losses, lossesB = recordB.losses;
  if (lossesA !== lossesB) return lossesA < lossesB ? "A" : "B";
  // Tied -> alternate from previous day, or default on day 1.
  if (previousFirstPicker == null) return defaultFirst;
  return previousFirstPicker === "A" ? "B" : "A";
}
