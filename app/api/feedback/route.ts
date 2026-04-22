import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { sendEmail, feedbackEmail } from "@/lib/email";

// POST /api/feedback
// Body: { type: 'support' | 'suggestion', name, email, message }
// Saves to Supabase and emails the site owner.

export async function POST(req: Request) {
  const body = await req.json();
  const { type, name, email, message } = body;

  if (!type || !message?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!["support", "suggestion"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  // Get the logged-in user if there is one (optional — forms work logged out too).
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const fromName = name?.trim() || user?.user_metadata?.name || "Anonymous";
  const fromEmail = email?.trim() || user?.email || "unknown";

  // Save to Supabase.
  const admin = createSupabaseAdminClient();
  const { error: dbErr } = await admin.from("feedback").insert({
    type,
    name: fromName,
    email: fromEmail,
    message: message.trim(),
    user_id: user?.id ?? null,
  });

  if (dbErr) {
    console.error("feedback: DB insert failed", dbErr);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  // Email the site owner.
  const { subject, html } = feedbackEmail({ type, fromName, fromEmail, message: message.trim() });
  await sendEmail({
    to: "jonathancasilli@gmail.com",
    subject,
    html,
  }).catch(console.error);

  return NextResponse.json({ ok: true });
}
