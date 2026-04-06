# Home Field Advantage

A web app for running 1v1 NHL pick'em competitions with a friend. Each night
of the slate you take turns drafting which game's winner you're picking, with
a snake-style draft order that keeps things fair across the week or season.

This first version supports:

- Google sign-in (via Supabase Auth)
- Daily, weekly, and full-regular-season competitions
- 1v1 head-to-head with shareable invite links and email invites
- Real NHL schedule pulled from the public NHL API
- Snake draft logic with all the special rules (defer-for-picks-2-and-3,
  forced last-three-picks, drop-an-odd-game, small-slate exception)
- Automatic scoring once games go final
- Per-day, per-week, and overall standings

---

## Quick start (for non-developers)

You'll need three free accounts:

1. **GitHub** — to store the code
2. **Supabase** — for the database and Google sign-in
3. **Vercel** — to host the live website

### 1. Get the code on your computer

If you already have the project folder ("Home Field Advantage"), open a terminal there:

```bash
cd "Home Field Advantage"
npm install
```

### 2. Create a Supabase project

1. Go to <https://supabase.com> and sign up.
2. Click **New project**, give it a name (e.g. "home-field-advantage"), and pick a region.
3. While you wait for it to provision, save the **database password** somewhere safe.
4. Once it's ready, click **SQL Editor** in the left sidebar, then **New query**.
5. Open the file `supabase/schema.sql` from this project, paste its entire contents into the editor, and click **Run**.
6. Click **Settings → API**. Copy these two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key
7. Click **Authentication → Providers** in the sidebar.
   - Toggle on **Google**.
   - You'll need a Google OAuth client. The Supabase docs walk you through it: <https://supabase.com/docs/guides/auth/social-login/auth-google>. The short version: go to <https://console.cloud.google.com/apis/credentials>, create an **OAuth client ID**, type "Web application", and add the redirect URL Supabase shows you. Paste the resulting Client ID + Secret back into Supabase.
8. Under **Authentication → URL Configuration**, set **Site URL** to `http://localhost:3000` for now. We'll change it to your Vercel URL after deploying.

### 3. Run it locally

In the project folder, copy the example env file:

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=<your project URL from step 2.6>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon public key from step 2.6>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then start the dev server:

```bash
npm run dev
```

Open <http://localhost:3000> in your browser. Sign in with Google, create a competition, and copy the invite link to share with a friend.

### 4. Deploy it to Vercel (so friends can use it)

1. Push the project to a new GitHub repository.
2. Go to <https://vercel.com>, sign in with GitHub, click **Add New → Project**, and import your repo.
3. In the **Environment Variables** section paste in the same three values from your `.env.local`. **For `NEXT_PUBLIC_SITE_URL`, use your future Vercel URL** — Vercel tells you what it'll be (something like `https://home-field-advantage.vercel.app`).
4. Click **Deploy**.
5. Once it's live, go back to Supabase → **Authentication → URL Configuration** and update **Site URL** and **Redirect URLs** to your Vercel URL. (Add both `https://your-app.vercel.app` and `https://your-app.vercel.app/auth/callback`.)
6. Also add the same redirect URL to your Google OAuth client in the Google Cloud Console.

That's it. Send the URL to a friend, both of you sign in with Google, create a competition, and start picking.

---

## How the pick logic works

For a competition longer than one day, on each night of the slate:

1. The player with the better record across **prior** nights picks first.
   On day one, the creator picks first. Ties go to whoever did *not* pick first
   the previous night.
2. The first picker can either take pick #1 alone, or **defer** and take picks
   #2 **and** #3 instead. (The UI defaults to "no defer" for now — surfacing the
   choice in the UI is the first follow-up I'd add.)
3. After pick #3, picks alternate.
4. Once you reach the 3rd-to-last and 2nd-to-last picks, the player who made
   the very first pick takes both, and the other player takes the very last.
5. If the slate has an odd number of games, one game is left unpicked.
6. If the slate has 3 or fewer games, each player picks exactly one.

The logic lives in `lib/picks.ts` and is unit-tested in `lib/picks.test.ts`
(`npm test` runs them).

## Project structure

```
app/
  page.tsx                       Landing + your competitions list
  login/                         Google sign-in page
  auth/callback/                 OAuth callback that swaps the code for a session
  auth/signout/                  Sign-out POST endpoint
  competitions/new/              "Create a competition" form
  competitions/[id]/             The competition room — pick UI
  join/[token]/                  Joining via shareable invite link
  api/competitions/[id]/picks/   Server-validated pick submission
  api/competitions/[id]/score/   Walks pending picks and scores them
lib/
  picks.ts                       Snake-draft logic (the heart of the app)
  picks.test.ts                  Unit tests for the draft logic
  nhl.ts                         Public NHL API wrapper
  supabase/client.ts             Browser-side Supabase client
  supabase/server.ts             Server-side Supabase client
supabase/
  schema.sql                     Database schema + RLS policies
middleware.ts                    Refreshes Supabase session cookies
```

## Roadmap (things you can add next)

- A toggle in the pick UI for the better-record player to defer for picks 2 & 3
- Push notifications when it's your turn
- Support for additional sports (NFL, NBA, MLB)
- Against-the-spread scoring
- More than 2 players per competition (would need a generalized snake draft)
- A proper email-invite delivery system (currently invites are recorded in the
  DB but not emailed — Supabase Auth's email templates can be wired up here)

## Running the tests

```bash
npm test
```

This runs `lib/picks.test.ts`, which validates the draft order generator
against every edge case described in the spec.
