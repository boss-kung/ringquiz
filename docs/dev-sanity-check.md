# Dev Sanity Check

Repeatable local validation flow for the RingQuiz frontend.

## Clean install

```bash
rm -rf node_modules
npm install
```

> Keep `package-lock.json` committed. It pins exact dependency versions so
> `npm ci` produces a reproducible install in CI/CD.  
> Use `npm ci` instead of `npm install` in automated pipelines.

## Type check

```bash
npm run typecheck
# equivalent: npx tsc --noEmit
```

Checks all `.ts`/`.tsx` files without emitting output. Must pass before merging.

## Build

```bash
npm run build
# equivalent: tsc -b && vite build
```

Compiles TypeScript project references, then Vite bundles to `dist/`.

## Preview built output

```bash
npm run preview
```

Serves `dist/` locally on <http://localhost:4173>.

## Lint

ESLint is not configured in this project. To add it:

```bash
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-react-hooks
```

Then run:

```bash
npx eslint src --ext .ts,.tsx
```

## Rollup platform-specific optional deps

If `npm install` prints warnings about optional Rollup native dependencies
(e.g. `@rollup/rollup-linux-x64-gnu`), these are safe to ignore on macOS/Windows.
They only affect Rollup's native speed optimisation; the JS fallback is used
automatically.

## Supabase Edge Functions

Edge Functions live in `supabase/functions/`. They are written in Deno TypeScript
and deployed via the Supabase CLI.

```bash
# Install Supabase CLI (once)
brew install supabase/tap/supabase   # macOS
# or: npm install -g supabase

# Lint/type-check edge functions (Deno)
deno check supabase/functions/host-action/index.ts
deno check supabase/functions/submit-answer/index.ts

# Deploy a single function
supabase functions deploy host-action --project-ref <your-project-ref>

# Deploy all functions
supabase functions deploy --project-ref <your-project-ref>
```

> Edge Functions do NOT share the same `node_modules` as the frontend.
> They use Deno's JSR/npm imports declared at the top of each file.

## Complete local validation flow

```bash
rm -rf node_modules
npm install
npm run typecheck   # must be clean (exit 0)
npm run build       # must succeed
```
