// Run with: npx tsx lib/picks.test.ts
import { generateDraftOrder, whoPicksFirst } from "./picks";

let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) {
    console.log("ok  ", label);
  } else {
    failed++;
    console.log("FAIL", label, "\n     got: ", g, "\n     want:", w);
  }
}

// ----- 3-or-fewer-games special case -----
eq("0 games -> empty",
  generateDraftOrder({ numGames: 0, firstPicker: "A", deferred: false }),
  { order: [], unpickedGames: 0 });

eq("1 game -> only A picks",
  generateDraftOrder({ numGames: 1, firstPicker: "A", deferred: false }),
  { order: ["A"], unpickedGames: 0 });

eq("2 games -> A then B",
  generateDraftOrder({ numGames: 2, firstPicker: "A", deferred: false }),
  { order: ["A", "B"], unpickedGames: 0 });

eq("3 games -> A then B, 1 unpicked",
  generateDraftOrder({ numGames: 3, firstPicker: "A", deferred: false }),
  { order: ["A", "B"], unpickedGames: 1 });

eq("3 games deferred -> B then A, 1 unpicked",
  generateDraftOrder({ numGames: 3, firstPicker: "A", deferred: true }),
  { order: ["B", "A"], unpickedGames: 1 });

// ----- normal flow, no deferral -----
// 4 games: collide rules -> only start rule applies, then alternate.
eq("4 games no defer -> A,B,B,A",
  generateDraftOrder({ numGames: 4, firstPicker: "A", deferred: false }).order,
  ["A", "B", "B", "A"]);

eq("4 games defer -> B,A,A,B",
  generateDraftOrder({ numGames: 4, firstPicker: "A", deferred: true }).order,
  ["B", "A", "A", "B"]);

// 5 games: drop one -> 4 picks, same as above
eq("5 games no defer -> A,B,B,A and 1 unpicked",
  generateDraftOrder({ numGames: 5, firstPicker: "A", deferred: false }),
  { order: ["A", "B", "B", "A"], unpickedGames: 1 });

// 6 games: start + end rules cleanly fit, no middle alternation needed
// start: A,B,B   end: A,A,B  -> A,B,B,A,A,B
eq("6 games no defer -> A,B,B,A,A,B",
  generateDraftOrder({ numGames: 6, firstPicker: "A", deferred: false }).order,
  ["A", "B", "B", "A", "A", "B"]);

eq("6 games defer -> B,A,A,B,B,A",
  generateDraftOrder({ numGames: 6, firstPicker: "A", deferred: true }).order,
  ["B", "A", "A", "B", "B", "A"]);

// 7 games: drop 1 -> 6 picks
eq("7 games no defer -> 6 picks A,B,B,A,A,B with 1 unpicked",
  generateDraftOrder({ numGames: 7, firstPicker: "A", deferred: false }),
  { order: ["A", "B", "B", "A", "A", "B"], unpickedGames: 1 });

// 8 games: A,B,B then alternate (A,B) then end (A,A,B)
//          -> A,B,B,A,B,A,A,B  ... wait check: positions 0..7
//          start fills 0..2 = A,B,B
//          alternate from pos 3 starting with A (since pos 2 = B): A at 3, B at 4
//          end overrides 5,6,7 -> A,A,B
//          final: A,B,B,A,B,A,A,B
eq("8 games no defer -> A,B,B,A,B,A,A,B",
  generateDraftOrder({ numGames: 8, firstPicker: "A", deferred: false }).order,
  ["A", "B", "B", "A", "B", "A", "A", "B"]);

// 8 games each player count: A=4, B=4
const r8 = generateDraftOrder({ numGames: 8, firstPicker: "A", deferred: false }).order;
eq("8 games balance",
  { A: r8.filter(p => p === "A").length, B: r8.filter(p => p === "B").length },
  { A: 4, B: 4 });

// 12 games: should still be balanced (6/6)
const r12 = generateDraftOrder({ numGames: 12, firstPicker: "A", deferred: false }).order;
eq("12 games balance",
  { A: r12.filter(p => p === "A").length, B: r12.filter(p => p === "B").length, len: r12.length },
  { A: 6, B: 6, len: 12 });

// ----- whoPicksFirst -----
eq("better record A picks first",
  whoPicksFirst({wins:5,losses:2,pushes:0},{wins:4,losses:3,pushes:0}, "B", "A"),
  "A");

eq("tie -> alternate (prev was A -> now B)",
  whoPicksFirst({wins:3,losses:3,pushes:0},{wins:3,losses:3,pushes:0}, "A", "A"),
  "B");

eq("tie + day 1 -> default",
  whoPicksFirst({wins:0,losses:0,pushes:0},{wins:0,losses:0,pushes:0}, null, "A"),
  "A");

console.log(failed === 0 ? "\nAll tests passed." : `\n${failed} test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
