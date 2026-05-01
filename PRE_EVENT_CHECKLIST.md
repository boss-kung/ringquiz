# Pre-Event Checklist

Work through this top-to-bottom on event day setup.
Each item is a concrete, verifiable action — not a reminder to "check things."

---

## Supabase Setup

- [ ] Project is on **Pro plan** (free tier max 200 Realtime connections — insufficient)
- [ ] Connection pooling is enabled: Settings → Database → Connection Pooling → Mode: Transaction
- [ ] **Anonymous sign-in** is enabled: Authentication → Providers → Anonymous
- [ ] Email sign-in is disabled (not needed for V1)
- [ ] Run migration `20260501000001_initial_schema.sql` in SQL Editor — no errors
- [ ] Run migration `20260501000002_helpers.sql` in SQL Editor — no errors
- [ ] Verify `game_status` enum exists: `SELECT unnest(enum_range(NULL::game_status));`
- [ ] Verify seed row: `SELECT id, status, current_question_id FROM game_state;` → 1 row, status=waiting, id=00000...001
- [ ] Verify `compute_leaderboard` function exists: `SELECT proname FROM pg_proc WHERE proname = 'compute_leaderboard';`
- [ ] Verify `increment_player_score` function exists: same query with that name
- [ ] Verify all RLS enabled: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';` → all TRUE
- [ ] Verify `question_masks` returns 0 rows using anon key client (not Studio): use browser console or curl
- [ ] Verify answers table has no INSERT policy: `SELECT * FROM pg_policies WHERE tablename = 'answers';` → only 1 policy (SELECT, own row)

---

## Storage Setup

- [ ] `question-images` bucket created with **Public = ON**
- [ ] `question-masks` bucket created with **Public = OFF**
- [ ] Storage RLS policy `public_read_question_images` applied (from migration)
- [ ] No permissive policy exists for `question-masks` objects
- [ ] Direct URL to question-masks file returns non-200:
      `curl -I "https://<project>.supabase.co/storage/v1/object/question-masks/test.txt"` → 400/403
- [ ] Direct URL to a question-images file returns 200:
      `curl -I "https://<project>.supabase.co/storage/v1/object/public/question-images/<filename>"` → 200

---

## Edge Function Setup

- [ ] `HOST_SECRET` set: `supabase secrets set HOST_SECRET=<min-32-char-random-string>`
- [ ] `HOST_SECRET` is stored somewhere safe outside the browser (paper or password manager)
- [ ] All 5 functions deployed: `supabase functions deploy --no-verify-jwt server-time get-question-stats export-results` and `supabase functions deploy submit-answer host-action`
- [ ] `server-time` returns valid JSON: `curl .../server-time` → `{"server_time_ms": <number>}`
- [ ] `host-action` rejects missing secret: `curl -X POST .../host-action -d '{"action":"reset_game"}'` → 401
- [ ] `host-action` rejects bad action name: `curl -X POST .../host-action -H "X-Host-Secret: $S" -d '{"action":"invalid"}'` → 400
- [ ] `submit-answer` rejects missing JWT: `curl -X POST .../submit-answer -d '{}'` → 401
- [ ] `submit-answer` rejects when status=waiting: open anon session, call with valid JWT → 400 question_not_open
- [ ] `get-question-stats` rejects missing secret → 401
- [ ] `export-results` rejects missing secret → 401
- [ ] `export-results` response has no `mask_storage_path`, `mask_width`, or `mask_height` fields
- [ ] PNG decoder in `mask-check.ts` is confirmed working (run a test submission with known coordinates)

---

## Question Data Validation

- [ ] All questions inserted into `questions` table
- [ ] All questions have `is_published = TRUE`
- [ ] `order_index` values are unique and sequential starting from 1: `SELECT order_index FROM questions ORDER BY order_index;`
- [ ] Every question has a matching row in `question_masks`: `SELECT q.id FROM questions q LEFT JOIN question_masks qm ON qm.question_id = q.id WHERE qm.question_id IS NULL;` → 0 rows
- [ ] Every `image_url` in `questions` matches an actual file in `question-images` bucket
- [ ] Every `mask_storage_path` in `question_masks` matches an actual file in `question-masks` bucket
- [ ] Mask PNG format correct (white=correct, black=wrong): open in image editor and inspect at least 1 mask per question
- [ ] For each question: mask dimensions (mask_width, mask_height) equal image dimensions (image_width, image_height)
- [ ] For each question: manually verify **at least 1 known-correct coordinate** via test submission
- [ ] For each question: manually verify **at least 1 known-incorrect coordinate** via test submission
  - Test procedure: run host-action start_countdown + open_question, submit via curl with test player JWT, verify is_correct matches expectation

---

## Dry Run (full game flow, in sequence)

- [ ] `reset_game` → verify: answers=0, leaderboard_snapshot=0, players.total_score all 0, status=waiting
- [ ] `start_countdown` → verify: status=countdown, current_question_id=Q1, current_question_index=1
- [ ] `open_question` → verify: status=question_open, question_started_at set, question_ends_at = started_at + time_limit_seconds
- [ ] Submit 2 test answers (one correct coordinate, one incorrect) during open window
- [ ] `get-question-stats` → verify: submitted_count=2
- [ ] `close_question` → verify: status=question_closed, entries_written=2 (or total player count)
- [ ] Call `close_question` again → verify: already_in_state=true, leaderboard unchanged
- [ ] `show_reveal` → verify: status=reveal
- [ ] `show_leaderboard` → verify: status=leaderboard
- [ ] `SELECT * FROM leaderboard_snapshot ORDER BY rank;` → correct ranks and scores
- [ ] `next_question` → verify: status=countdown, current_question_id=Q2, current_question_index=2
- [ ] Repeat open/close/reveal/leaderboard cycle for Q2
- [ ] After last question: `end_game` → verify: status=ended
- [ ] `export-results` → valid JSON, all answers present, no mask fields
- [ ] Final `reset_game` → verify full reset (answers=0, leaderboard=0, scores=0, status=waiting)
- [ ] Idempotency check: call `recompute_leaderboard` twice after closing a question → same entries_written, same leaderboard rows

---

## Load Test

Required (300 concurrent):
- [ ] 300 concurrent `signInAnonymously()` calls complete without error
- [ ] 300 concurrent player row inserts succeed (no RLS rejection, no constraint violation)
- [ ] 300 concurrent `submit-answer` calls during a single open question window
- [ ] `SELECT COUNT(*) FROM answers WHERE question_id = '<id>';` → exactly 300 (no duplicates, no missed)
- [ ] `compute_leaderboard` produces 300 entries correctly
- [ ] Supabase Realtime dashboard: connection count stays within plan limit during test
- [ ] `server-time` p95 latency < 500 ms measured from event venue network
- [ ] `submit-answer` error rate = 0% for valid submissions during load test

Optional (500 concurrent, if expected headcount is 450+):
- [ ] Repeat all load test steps with 500 concurrent sessions
- [ ] Verify Realtime connection count stays ≤ 500 during peak
- [ ] Verify no DB connection pool exhaustion (monitor in Supabase dashboard)

---

## Event Day Start State

Verify immediately before opening the event to players:

- [ ] `SELECT status FROM game_state;` → `waiting`
- [ ] `SELECT current_question_id FROM game_state;` → `NULL`
- [ ] `SELECT current_question_index FROM game_state;` → `NULL`
- [ ] `SELECT COUNT(*) FROM answers;` → `0`
- [ ] `SELECT COUNT(*) FROM leaderboard_snapshot;` → `0`
- [ ] `SELECT COUNT(*), SUM(total_score) FROM players;` → scores = 0 (or table empty)
- [ ] Host browser: HostPage loaded, HOST_SECRET entered and validated
- [ ] Host browser: on a wired connection (not Wi-Fi) if possible
- [ ] Supabase Studio open in a second browser tab as emergency override
- [ ] Edge Function curl commands saved and ready (see below)
- [ ] HOST_SECRET available on paper or in a password manager (not only in the browser)

---

## Host Fallback

Emergency procedures — know these before the event starts.

| Situation | Action |
|---|---|
| Host browser crashes | Reopen HostPage → re-enter HOST_SECRET → game state is preserved in DB |
| Host UI button unresponsive | Run curl for the same action directly (commands below) |
| Question stuck open | `curl -X POST .../host-action -H "X-Host-Secret: $S" -d '{"action":"force_close_question"}'` |
| Leaderboard looks wrong | `curl -X POST .../host-action -H "X-Host-Secret: $S" -d '{"action":"recompute_leaderboard"}'` |
| Need raw data urgently | `curl -H "X-Host-Secret: $S" .../export-results > results.json` |
| Realtime drops for players | Players auto re-fetch game_state on reconnect — no host action needed |
| Full restart needed | `{"action":"reset_game"}` — requires typed confirmation in UI. Destroys all answers. |

Emergency curl commands (save these with $S = HOST_SECRET value):

```bash
# force close current question
curl -X POST https://<project>.supabase.co/functions/v1/host-action \
  -H "X-Host-Secret: $S" \
  -H "Content-Type: application/json" \
  -d '{"action":"force_close_question"}'

# recompute leaderboard
curl -X POST https://<project>.supabase.co/functions/v1/host-action \
  -H "X-Host-Secret: $S" \
  -H "Content-Type: application/json" \
  -d '{"action":"recompute_leaderboard"}'

# export results
curl -H "X-Host-Secret: $S" \
  https://<project>.supabase.co/functions/v1/export-results \
  > results_$(date +%Y%m%d_%H%M%S).json

# check current state
curl https://<project>.supabase.co/functions/v1/get-question-stats \
  -H "X-Host-Secret: $S"
```
