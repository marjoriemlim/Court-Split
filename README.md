# Shuttle Ledger

Auto-calculates court fees, shuttle costs, and guest markup ("funds") for weekly badminton sessions. Regulars pay actual cost (even for guests they personally bring); guests pay a fixed rate, and the difference becomes profit ("funds").

## How the math works

- Every session has a **court fee per slot**, **shuttle cost per person**, and a **guest fixed rate** (defaults: 175 / 93.33 / 300 — editable per session).
- A **payment group** = one payer covering a headcount of people (themselves + anyone they bring), plus optional water/penalty.
- `actual_cost = (court_fee_per_slot + shuttle_unit_cost) × headcount + water_cost`
- If the payer is a **Regular** → they pay `actual_cost`. No funds generated, even if they're covering guests.
- If the payer is a **Guest** → they pay `guest_fixed_rate × headcount`. Funds = `(guest_fixed_rate × headcount) − actual_cost`.

Status lives on the **player** (Players tab) and is snapshotted onto each payment group when added, so changing someone's status later doesn't rewrite history.

---

## 1. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → New project. Pick any name/region, set a database password.
2. Once it's ready, open **SQL Editor** and paste in the full contents of `supabase/schema.sql` from this repo, then run it. This creates the `players`, `sessions`, and `payment_groups` tables plus a helper view.
3. Go to **Project Settings → API Keys**. Copy:
   - **Project URL** (from the Connect dialog or API settings) → this is `VITE_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_...`, under the API Keys tab — click "Create new API keys" if you don't see one yet) → this is `VITE_SUPABASE_PUBLISHABLE_KEY`

   Note: Supabase is phasing out the older `anon` key in favor of publishable keys — same low privileges, same RLS behavior, just a new format. Use the publishable key from the start so you don't need to migrate later.
4. Go to **Authentication → Providers** and make sure **Email** is enabled (it is by default). This app uses magic-link (passwordless) sign-in — no extra config needed, but under **Authentication → URL Configuration**, add your future GitHub Pages URL (see step 3 below) to **Redirect URLs**, e.g. `https://yourusername.github.io/badminton-payments/`.
5. Add yourself (and any co-admin) as a user: **Authentication → Users → Add user**, or just sign in once from the app and it'll send you a magic link to that email.

## 2. Push this code to GitHub

```bash
cd badminton-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/badminton-payments.git
git push -u origin main
```

> If you name your repo something other than `badminton-payments`, update the `base` path in `vite.config.js` to match — it must be `/your-repo-name/`.

## 3. Add your Supabase keys as GitHub Secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**. Add two:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

(Use the values from Supabase step 1.3 above.)

## 4. Enable GitHub Pages

**Settings → Pages → Build and deployment → Source → GitHub Actions.**

That's it — the workflow in `.github/workflows/deploy.yml` runs automatically on every push to `main` and deploys to `https://YOUR-USERNAME.github.io/badminton-payments/`.

## 5. Add players

Once deployed, sign in (magic link goes to your email), go to the **Players** tab, and add your roster with their status (Regular/Guest). You can flip anyone's status anytime.

---

## Local development

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL/key
npm run dev
```

## Project structure

```
supabase/schema.sql       — run once in Supabase SQL Editor
src/lib/calc.js           — the payment calculation engine (pure functions)
src/lib/supabaseClient.js — Supabase connection
src/pages/Login.jsx       — magic-link sign-in
src/pages/Players.jsx     — manage roster + status
src/pages/SessionPage.jsx — today's session: add payment groups, live totals
src/pages/History.jsx     — past sessions + all-time accumulated funds
```
