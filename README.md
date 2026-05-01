# Quiz Game

Single-room realtime multiplayer quiz game. Players tap on an image to mark their answer; the host controls game flow from a password-protected panel.

## Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- Supabase CLI (`brew install supabase/tap/supabase`) — optional, for local dev

## Local development

```bash
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
# App available at http://localhost:5173
# Host panel at http://localhost:5173/host
```

> **Note:** Without real Supabase credentials the app will render screens but all data flows will fail silently. You must point at a live (or local) Supabase project for realtime updates, auth, and answer submission to work.

### Running Edge Functions locally

Start the Supabase local stack (requires Docker):

```bash
supabase start
supabase functions serve
```

Then set `VITE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1` in `.env.local` so the frontend hits local functions instead of the cloud project.

### Type-checking Edge Functions (no Docker)

```bash
cd supabase/functions/submit-answer
deno check index.ts
deno test --allow-read mask-check.test.ts
```

## Deployment (GitHub Pages)

This repo is configured for GitHub Pages at:

- Production URL: `https://boss-kung.github.io/ringquiz/`
- Host panel URL: `https://boss-kung.github.io/ringquiz/host`

### GitHub setup

1. Push the repo to the `main` branch on GitHub.
2. In the repository, go to `Settings` → `Secrets and variables` → `Actions`.
3. Add this repository secret:
   - `VITE_SUPABASE_ANON_KEY`
4. Go to `Settings` → `Pages`.
5. Under **Build and deployment**, set **Source** to `GitHub Actions`.

### Workflow behavior

The included workflow file `.github/workflows/deploy.yml` will:

1. Run on every push to `main`
2. Install dependencies with `npm ci`
3. Build with `npm run build`
4. Publish the `dist` folder to GitHub Pages

### Supabase frontend environment values

- `VITE_SUPABASE_URL=https://lfvwdeqfyscalfucfhlp.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<set as GitHub Actions secret>`

### SPA routing on GitHub Pages

GitHub Pages is static hosting, so direct refreshes like `/ringquiz/host` need a fallback.
This repo includes:

- `vite.config.ts` with `base: '/ringquiz/'`
- `public/404.html` for SPA redirect fallback
- `public/.nojekyll` so Pages serves the built files as-is

## Host panel

Navigate to `/host`. Enter the `HOST_SECRET` (set via `supabase secrets set HOST_SECRET=...`).
The secret is stored in `sessionStorage` only — it clears when the tab is closed.

## Architecture notes

- **Realtime**: single Supabase channel `game-room`, subscribes to `game_state` UPDATE events.
- **Coordinates**: stored as ratios `[0, 1]` relative to the rendered image size.
- **Mask validation**: runs server-side in the `submit-answer` Edge Function — mask paths are never exposed to the client.
- **Player identity**: anonymous Supabase auth (`signInAnonymously`), session persisted in localStorage.
