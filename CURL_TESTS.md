# Manual Curl Tests for submit-answer

Run these in sequence to validate the full submission flow locally and in production.

## Prerequisites

```bash
# 1. Start local Edge Functions runtime
supabase functions serve submit-answer --no-verify-jwt

# Local base URL
BASE=http://localhost:54321/functions/v1

# Production base URL (use this for production tests)
# BASE=https://<project-ref>.supabase.co/functions/v1

# 2. Obtain a player JWT by signing in anonymously via Supabase client
#    OR use the Supabase dashboard → Authentication → Users → Create anon user
#    For local: use the anon key directly as the JWT (local dev only)
ANON_KEY="your-supabase-anon-key"

# 3. Set up game state for testing:
#    - Insert a test question into questions table
#    - Insert a mask row into question_masks
#    - Upload the mask PNG to question-masks bucket

# These values must match real rows in your test database
QUESTION_ID="your-question-uuid-here"
PLAYER_JWT="your-player-jwt-here"
HOST_SECRET="your-host-secret-here"
```

---

## Step 1: Confirm server-time is reachable

```bash
curl "$BASE/server-time"
# Expected: { "server_time_ms": <number> }
# This confirms Edge Functions are serving.
```

---

## Step 2: Set up game state for testing

```bash
# Ensure game state is question_open for your test question
curl -X POST "$BASE/host-action" \
  -H "X-Host-Secret: $HOST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"start_countdown"}'

curl -X POST "$BASE/host-action" \
  -H "X-Host-Secret: $HOST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"open_question"}'

# Verify: status should be question_open, question_ends_at should be set
curl "$BASE/get-question-stats" \
  -H "X-Host-Secret: $HOST_SECRET"
```

---

## Test A: Known correct coordinate

Submit a coordinate that overlaps a white pixel in the mask.
(Determine the correct pixel by inspecting the mask image before the event.)

```bash
curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"question_id\": \"$QUESTION_ID\",
    \"x_ratio\": 0.45,
    \"y_ratio\": 0.32
  }"

# Expected:
# {
#   "is_correct": true,
#   "score": <number between min_correct_score and max_score>,
#   "already_submitted": false
# }
#
# Verify: score decreases if you wait longer before submitting.
# Verify: mask_storage_path is NOT in the response.
```

---

## Test B: Known incorrect coordinate

Submit a coordinate that lands on a black/transparent pixel in the mask.

```bash
# Use a different player JWT (each player can only submit once per question)
# OR call reset_game first and get a fresh anon session

PLAYER_JWT_2="second-player-jwt-here"

curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT_2" \
  -H "Content-Type: application/json" \
  -d "{
    \"question_id\": \"$QUESTION_ID\",
    \"x_ratio\": 0.02,
    \"y_ratio\": 0.02
  }"

# Expected:
# {
#   "is_correct": false,
#   "score": 0,
#   "already_submitted": false
# }
```

---

## Test C: Duplicate submission (idempotency)

Submit the same request again with the same player JWT.

```bash
curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"question_id\": \"$QUESTION_ID\",
    \"x_ratio\": 0.45,
    \"y_ratio\": 0.32
  }"

# Expected: identical result as Test A, with already_submitted: true
# {
#   "is_correct": true,
#   "score": <same score as Test A>,
#   "already_submitted": true
# }
#
# Score must be identical — not recomputed with current server time.
# This confirms idempotency: retrying after a network drop is safe.
```

---

## Test D: Expired question (late submission)

Close the question first, then attempt a submission.

```bash
# Close the question
curl -X POST "$BASE/host-action" \
  -H "X-Host-Secret: $HOST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"close_question"}'

# Attempt late submission with a fresh player JWT
PLAYER_JWT_3="third-player-jwt-here"

curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT_3" \
  -H "Content-Type: application/json" \
  -d "{
    \"question_id\": \"$QUESTION_ID\",
    \"x_ratio\": 0.45,
    \"y_ratio\": 0.32
  }"

# Expected:
# HTTP 400
# { "error": "question_not_open" }
#
# Note: the server rejects this because game_state.status !== 'question_open'.
# Even if the request arrives 1ms after question_ends_at, it is rejected.
```

---

## Test E: Wrong game state (waiting)

Try submitting while game state is 'waiting'.

```bash
# Reset to waiting
curl -X POST "$BASE/host-action" \
  -H "X-Host-Secret: $HOST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"reset_game"}'

curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"question_id\": \"$QUESTION_ID\",
    \"x_ratio\": 0.5,
    \"y_ratio\": 0.5
  }"

# Expected:
# HTTP 400
# { "error": "question_not_open" }
```

---

## Test F: Missing or invalid JWT

```bash
# No Authorization header
curl -X POST "$BASE/submit-answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id":"any","x_ratio":0.5,"y_ratio":0.5}'
# Expected: HTTP 401 { "error": "unauthorized" }

# Malformed JWT
curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer not-a-real-jwt" \
  -H "Content-Type: application/json" \
  -d '{"question_id":"any","x_ratio":0.5,"y_ratio":0.5}'
# Expected: HTTP 401 { "error": "unauthorized" }
```

---

## Test G: Invalid ratio values

```bash
# While question is open
curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"question_id\":\"$QUESTION_ID\",\"x_ratio\":-0.1,\"y_ratio\":0.5}"
# Expected: HTTP 400 { "error": "invalid_ratio", "field": "x_ratio" }

curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"question_id\":\"$QUESTION_ID\",\"x_ratio\":0.5,\"y_ratio\":1.5}"
# Expected: HTTP 400 { "error": "invalid_ratio", "field": "y_ratio" }
```

---

## Test H: Wrong question_id

```bash
curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"question_id":"00000000-0000-0000-0000-000000000099","x_ratio":0.5,"y_ratio":0.5}'
# Expected: HTTP 400 { "error": "wrong_question" }
```

---

## Test I: Response safety check

Verify that sensitive fields never appear in any response.

```bash
# Check Test A response for forbidden fields
curl -X POST "$BASE/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"question_id\":\"$QUESTION_ID\",\"x_ratio\":0.45,\"y_ratio\":0.32}" \
| python3 -c "
import sys, json
r = json.load(sys.stdin)
forbidden = ['mask_storage_path', 'mask_width', 'mask_height', 'time_remaining_ratio']
found = [f for f in forbidden if f in r]
if found:
    print('FAIL — forbidden fields found:', found)
else:
    print('PASS — no forbidden fields in response')
    print('Response keys:', list(r.keys()))
"

# Expected output:
# PASS — no forbidden fields in response
# Response keys: ['is_correct', 'score', 'already_submitted']
```

---

## Local Unit Test Runner

```bash
# From project root
deno test \
  supabase/functions/submit-answer/mask-check.test.ts \
  --allow-net \
  --allow-read

# Run with verbose output
deno test \
  supabase/functions/submit-answer/mask-check.test.ts \
  --allow-net \
  --allow-read \
  --reporter=verbose

# Run a single named test
deno test \
  supabase/functions/submit-answer/mask-check.test.ts \
  --allow-net \
  --filter "all-white mask"
```

---

## Local Integration Test (functions serve)

```bash
# Terminal 1: serve the function
supabase functions serve submit-answer --env-file .env.local

# Terminal 2: confirm no import errors in startup log
# The log should show: "Listening on http://localhost:54321"
# with no "Module not found" or "import error" messages.

# Terminal 3: run Test A
PLAYER_JWT=$(supabase auth sign-in --anon --json | jq -r .access_token)
curl -X POST "http://localhost:54321/functions/v1/submit-answer" \
  -H "Authorization: Bearer $PLAYER_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"question_id\":\"$QUESTION_ID\",\"x_ratio\":0.45,\"y_ratio\":0.32}"
```

---

## Verifying mask-check correctness with a real mask

If you have a specific question image and know the answer zone:

```bash
# 1. Open the mask PNG in an image editor
# 2. Find the pixel coordinates of a white pixel (correct zone)
#    e.g., pixel at (420, 310) in an 800x600 image
# 3. Compute ratios: x_ratio = 420/800 = 0.525, y_ratio = 310/600 = 0.517
# 4. Submit with those ratios → should return is_correct: true

# 5. Find a black pixel (e.g., 10, 10)
#    x_ratio = 10/800 = 0.0125, y_ratio = 10/600 = 0.0167
# 6. Submit → should return is_correct: false
```
