import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// PUT /api/profile
// Body: { displayName: string }
export async function PUT(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { displayName } = await req.json();
  if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
    return NextResponse.json({ error: "display name is required" }, { status: 400 });
  }
  if (displayName.trim().length > 30) {
    return NextResponse.json({ error: "display name must be 30 characters or fewer" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName.trim() })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
