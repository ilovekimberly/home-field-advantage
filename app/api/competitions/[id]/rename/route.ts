import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

const MAX_NAME_LENGTH = 60;

// POST /api/competitions/:id/rename
// Body: { name }
// Creator-only. Renaming is cosmetic — it doesn't affect picks or scoring.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawName = typeof body.name === "string" ? body.name.trim() : "";

  if (!rawName) {
    return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  // Admin client: RLS on competitions blocks pool members from reading the
  // row, and we need to verify creator_id before allowing the update.
  const admin = createSupabaseAdminClient();
  const { data: comp } = await admin
    .from("competitions")
    .select("id, creator_id")
    .eq("id", params.id)
    .single();

  if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (comp.creator_id !== user.id) {
    return NextResponse.json(
      { error: "Only the competition creator can rename it" },
      { status: 403 }
    );
  }

  const { error } = await admin
    .from("competitions")
    .update({ name: rawName })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, name: rawName });
}
