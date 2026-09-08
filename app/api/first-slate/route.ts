import { NextResponse } from "next/server";
import { resolveFirstSlate } from "@/lib/schedule";

// GET /api/first-slate?sport=NFL&date=2026-09-04
//
// Returns the pick-date of the first slate that still has games on or after
// `date`. The competition creation form calls this so a pool never opens on a
// week whose games have already been played (e.g. an NFL start date landing
// inside ESPN's long preseason window).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport") ?? "";
  const date = searchParams.get("date") ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  try {
    const startDate = await resolveFirstSlate(sport, date);
    return NextResponse.json({ startDate });
  } catch {
    // Never block competition creation on this — fall back to the raw date.
    return NextResponse.json({ startDate: date });
  }
}
