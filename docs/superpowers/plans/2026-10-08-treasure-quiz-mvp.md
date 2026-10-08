# Treasure Quiz MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างเว็บเกมส่วนตัวสำหรับ Host หนึ่งคนและ Player หนึ่งคน เล่นคำถาม 8 รอบ สะสมทอง/เพชร เปิดหีบหลายใบ และเก็บเงินบาทไว้แลกรางวัลจริง

**Architecture:** เพิ่ม Vite/React app ใหม่ที่ `treasure-quiz/` โดยไม่แก้ runtime ของ RingQuiz เดิม ใช้ Supabase project เดียวกันผ่านตาราง `tq_*`, RLS, Realtime และ Edge Functions สองตัว ธุรกรรมที่กระทบคำตอบ ทรัพยากร หีบ และ Wallet ทำฝั่งเซิร์ฟเวอร์ทั้งหมด

**Tech Stack:** React 18, TypeScript 5.5, Vite 5, Zustand 5, Supabase JS 2, Vitest, React Testing Library, Playwright, Supabase Postgres/RLS/Realtime, Deno Edge Functions

**Spec:** `docs/superpowers/specs/2026-10-08-treasure-quiz-design.md`

## Global Constraints

- รองรับ Host หนึ่งคน, Player หนึ่งคน และ active game ครั้งละหนึ่งเกมเท่านั้น
- Frontend ใหม่ต้องอยู่ใน `treasure-quiz/` และ build/deploy แยกจาก RingQuiz
- ตารางใช้ prefix `tq_`; Edge Functions ใช้ prefix `treasure-`
- ใช้ Supabase project เดียวกับ RingQuiz แต่ห้ามเปลี่ยนพฤติกรรม table/function เดิม
- `HOST_PIN` และ `PLAYER_PIN` เป็น Edge Function secrets; ห้ามใส่ใน source หรือ `VITE_*`
- Client ห้ามเขียนทอง เพชร เงินบาท ผลคำตอบ หรือผลหีบโดยตรง
- เงินเก็บเป็น integer หน่วยสตางค์และห้ามติดลบ
- ทอง/เพชรใช้เฉพาะเกมปัจจุบันและต้องเหลือศูนย์หลังยืนยัน Prize Shop
- บาทสะสมข้ามเกม ใช้แลกรางวัลเท่านั้น และไม่หมดอายุ
- ต้องมีคำถามครบ 50 ข้อตาม 8 รอบก่อนสร้างเกม
- UI เป็นภาษาไทย mobile-first และรองรับหน้าจอกว้างอย่างน้อย 320px
- ไม่มี public account, matchmaking, multi-room, payment integration หรือการซื้อทรัพยากรด้วยเงินจริง

## Review Focus

- Double tap/retry ของ submit answer และ open chest ต้องคืนผลเดิมโดยไม่เพิ่มทองหรือเงินบาทซ้ำ — pinned ใน Task 4 และ Task 8
- หมดเวลา/refresh ตรง server deadline ต้องกลับ phase เดิมและไม่รับคำตอบช้า — pinned ใน Task 4 และ Task 6
- คำถามไม่ครบ 50 ข้อ, choice ซ้ำ, correct answer ไม่อยู่ใน choices หรือ reward weights ไม่รวม 100 ต้องบล็อกการบันทึก/สร้างเกม — pinned ใน Task 3 และ Task 5
- Player login จากเครื่องใหม่ต้องแทน auth UID เดิมและทำให้ UID เก่าอ่าน/เขียน profile ไม่ได้ — pinned ใน Task 2 และ Task 4
- Discount, Crystal และ Closeout ต้องทำให้ cart เหลือทอง/เพชรศูนย์โดยไม่มีค่าติดลบ — pinned ใน Task 3 และ Task 8

---

## File Structure

### New frontend

- `treasure-quiz/src/domain/types.ts`: API/UI types เท่านั้น; ไม่มี business calculations
- `treasure-quiz/src/lib/api.ts`: typed wrapper สำหรับ Edge Functions
- `treasure-quiz/src/lib/supabase.ts`: Supabase client และ env validation
- `treasure-quiz/src/lib/routing.ts`: route `/host` และ `/play`
- `treasure-quiz/src/store/gameStore.ts`: session, game snapshot และ UI state
- `treasure-quiz/src/hooks/useGameRealtime.ts`: subscribe ตาราง Treasure Quiz
- `treasure-quiz/src/screens/host/*`: Host login, setup, lobby, controller, redemption
- `treasure-quiz/src/screens/player/*`: Player login, briefing, question, event, prize shop, wallet
- `treasure-quiz/src/components/questions/*`: UI ของคำถามแต่ละรูปแบบ
- `treasure-quiz/src/components/*`: timer, resource bar, chest และ shared feedback

### Supabase

- `supabase/migrations/20261008000001_treasure_quiz.sql`: schema, constraints, RLS, Realtime publication และ seed ค่าเริ่มต้น
- `supabase/tests/treasure_quiz_schema.test.sql`: pgTAP schema/RLS tests
- `supabase/functions/_shared/treasure-types.ts`: server request/domain types
- `supabase/functions/_shared/treasure-game.ts`: pure reward, betting, Event และ chest calculations
- `supabase/functions/_shared/treasure-repository.ts`: database operations used by handlers
- `supabase/functions/treasure-host-action/*`: Host command handler
- `supabase/functions/treasure-player-action/*`: Player command handler

---

### Task 1: Scaffold the independent Treasure Quiz app

**Files:**
- Create: `treasure-quiz/package.json`
- Create: `treasure-quiz/index.html`
- Create: `treasure-quiz/vite.config.ts`
- Create: `treasure-quiz/tsconfig.json`
- Create: `treasure-quiz/src/main.tsx`
- Create: `treasure-quiz/src/App.tsx`
- Create: `treasure-quiz/src/index.css`
- Create: `treasure-quiz/src/lib/routing.ts`
- Create: `treasure-quiz/src/lib/supabase.ts`
- Create: `treasure-quiz/src/test/setup.ts`
- Test: `treasure-quiz/src/lib/routing.test.ts`
- Test: `treasure-quiz/src/App.test.tsx`

**Interfaces:**
- Produces: `getAppPath(pathname?: string): '/host' | '/play'`
- Produces: independent commands `npm run dev`, `npm run test`, `npm run build`, `npm run test:e2e`

- [ ] **Step 1: Write failing shell tests**

  Test `getAppPath('/host') === '/host'`, `getAppPath('/play') === '/play'`, unknown paths default to `/play`, and `App` renders a Host or Player shell without importing RingQuiz modules.

- [ ] **Step 2: Run tests and confirm failure**

  Run: `npm --prefix treasure-quiz test -- --run`

  Expected: FAIL because the new app and routing modules do not exist.

- [ ] **Step 3: Create the Vite app and test configuration**

  Add React 18, TypeScript 5.5, Vite 5, Zustand 5, Supabase JS 2, Vitest, Testing Library and Playwright. Use plain CSS tokens rather than a component framework. Add `.env.example` containing only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` names.

- [ ] **Step 4: Implement the route shell and Supabase env validation**

  `App` chooses Host or Player shell from `getAppPath()`. `supabase.ts` throws a readable startup error when either public Supabase env value is absent.

- [ ] **Step 5: Verify tests and production build**

  Run: `npm --prefix treasure-quiz test -- --run`

  Run: `npm --prefix treasure-quiz run build`

  Expected: all tests PASS and `treasure-quiz/dist/index.html` exists.

- [ ] **Step 6: Commit**

  ```bash
  git add treasure-quiz
  git commit -m "feat: scaffold Treasure Quiz app"
  ```

### Task 2: Add the minimal Supabase schema and RLS

**Files:**
- Create: `supabase/migrations/20261008000001_treasure_quiz.sql`
- Create: `supabase/tests/treasure_quiz_schema.test.sql`
- Create: `treasure-quiz/src/lib/database.types.ts`

**Interfaces:**
- Produces tables: `tq_player_profile`, `tq_questions`, `tq_games`, `tq_rounds`, `tq_answers`, `tq_chest_types`, `tq_chest_opens`, `tq_wallet_entries`, `tq_reward_catalog`, `tq_redemptions`
- Produces enums: `tq_game_phase`, `tq_bet_type`, `tq_question_type`, `tq_redemption_status`
- Produces constraint: at most one `tq_games` row whose phase is not `finished` or `cancelled`

- [ ] **Step 1: Write failing pgTAP tests**

  Assert all ten tables and four enums exist; money/resource columns reject negative values; `(game_id, round_no, question_id)` answers are unique; `idempotency_key` is unique on `tq_chest_opens` and `tq_wallet_entries`; direct anon writes to authoritative tables fail; a player can read `tq_player_profile` only when `auth.uid() = auth_user_id`; and client roles cannot select `tq_questions.correct_answer` or raw `tq_answers` rows.

- [ ] **Step 2: Run schema tests and confirm failure**

  Run: `supabase test db supabase/tests/treasure_quiz_schema.test.sql`

  Expected: FAIL because the `tq_*` schema does not exist.

- [ ] **Step 3: Implement schema, constraints and RLS**

  Use UUID primary keys, `BIGINT` for satang, integer gold/gems, JSONB only for immutable game config snapshots and weighted reward tables. Enable Realtime for `tq_games`, `tq_rounds`, `tq_chest_opens` and `tq_redemptions`. Do not grant direct client writes to authoritative tables.

- [ ] **Step 4: Seed the five default chest types**

  Seed exact prices and percentages from spec section 10. Add SQL tests that the seeded JSON arrays total 100 and contain positive integer `amount_satang` values; Task 3 supplies the validator used for every later Host edit.

- [ ] **Step 5: Add the stale-auth RLS regression test**

  Link the singleton profile to auth UID A, then update it as service role to UID B. Assert A can no longer select the profile and B can.

- [ ] **Step 6: Verify and generate TypeScript database types**

  Run: `supabase test db supabase/tests/treasure_quiz_schema.test.sql`

  Run: `supabase gen types typescript --local > treasure-quiz/src/lib/database.types.ts`

  Expected: pgTAP PASS and generated types include every `tq_*` table.

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/migrations/20261008000001_treasure_quiz.sql supabase/tests/treasure_quiz_schema.test.sql treasure-quiz/src/lib/database.types.ts
  git commit -m "feat: add Treasure Quiz database schema"
  ```

### Task 3: Implement the server-side game and economy engine

**Files:**
- Create: `supabase/functions/_shared/treasure-types.ts`
- Create: `supabase/functions/_shared/treasure-game.ts`
- Test: `supabase/functions/_shared/treasure-game.test.ts`

**Interfaces:**
- Produces: `settleRound(input: RoundSettlementInput): RoundSettlement`
- Produces: `applyEvent(input: EventInput): EventResult`
- Produces: `quoteChestCart(input: ChestCartInput): ChestCartQuote`
- Produces: `drawWeightedReward(table: WeightedReward[], randomUnit: number): number`
- Produces: `validateQuestionSet(questions: QuestionDefinition[]): ValidationResult`

- [ ] **Step 1: Write failing settlement tests**

  Pin these exact cases: round 1 Safe 10/10 returns 200 gold; round 5 with 4 correct and 8 seconds left returns 240 gold; round 7 wrong after two correct returns 120 gold and no gem; round 3 Gold bet with 4 correct returns base 160, bet bonus 80 and stake refund 100; Diamond bet failure returns no gem refund.

- [ ] **Step 2: Write failing validation and chest tests**

  Assert a 49-question set fails; duplicate choices fail; a correct answer outside choices fails; reward weights totaling 99 fail; random values `0`, boundary values and `0.999999` select deterministic configured rewards; cart quote applies one Silver-or-higher discount and requires final gold/gems exactly zero.

- [ ] **Step 3: Run tests and confirm failure**

  Run: `deno test --allow-read supabase/functions/_shared/treasure-game.test.ts`

  Expected: FAIL because the domain functions do not exist.

- [ ] **Step 4: Implement the pure domain functions**

  Use the eight round rules and calculation order from the spec. `drawWeightedReward` accepts injected `randomUnit` so tests never depend on randomness. `quoteChestCart` adds Crystal and Closeout choices but never silently changes a requested main chest.

- [ ] **Step 5: Verify domain tests**

  Run: `deno test --allow-read supabase/functions/_shared/treasure-game.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/functions/_shared/treasure-types.ts supabase/functions/_shared/treasure-game.ts supabase/functions/_shared/treasure-game.test.ts
  git commit -m "feat: add Treasure Quiz game engine"
  ```

### Task 4: Add authenticated Host and Player action APIs

**Files:**
- Create: `supabase/functions/_shared/treasure-repository.ts`
- Create: `supabase/functions/treasure-host-action/index.ts`
- Create: `supabase/functions/treasure-host-action/handler.ts`
- Test: `supabase/functions/treasure-host-action/handler.test.ts`
- Create: `supabase/functions/treasure-player-action/index.ts`
- Create: `supabase/functions/treasure-player-action/handler.ts`
- Test: `supabase/functions/treasure-player-action/handler.test.ts`

**Interfaces:**
- Produces: `handleHostAction(request: HostActionRequest, deps: HostDeps): Promise<Response>`
- Produces: `handlePlayerAction(request: PlayerActionRequest, deps: PlayerDeps): Promise<Response>`
- Host actions: `save_question`, `save_chest_type`, `save_reward_item`, `create_game`, `start_game`, `open_briefing`, `start_round`, `reveal_round`, `advance_phase`, `pause_game`, `resume_game`
- Player actions: `link_profile`, `join_game`, `place_bet`, `submit_answer`, `restore_game`

- [ ] **Step 1: Write failing handler tests**

  With fake repositories, assert wrong Host/Player PIN returns 401; `create_game` rejects invalid 50-question setup; a second active game returns 409; `link_profile` replaces the prior auth UID; Gold/Diamond stakes cannot make resources negative; duplicate `place_bet` or `submit_answer` returns the original result; an answer at or after the server deadline returns 409 without a row; and the current-question response omits `correct_answer` and unrevealed settlement fields.

- [ ] **Step 2: Run tests and confirm failure**

  Run: `deno test --allow-env --allow-read supabase/functions/treasure-host-action/handler.test.ts supabase/functions/treasure-player-action/handler.test.ts`

  Expected: FAIL because handlers and repositories do not exist.

- [ ] **Step 3: Implement repository boundaries and handlers**

  Read PIN values only from injected dependencies/Edge Function env. Verify Supabase JWT for every Player action after `link_profile`. Use service-role database access only inside Edge Functions. Store authoritative deadlines and answers in database transactions/RPCs; keep `tq_rounds.correct_count` and reward fields null until Host invokes `reveal_round`, then settle and publish them atomically.

- [ ] **Step 4: Add CORS and structured error responses**

  Reuse `supabase/functions/_shared/cors.ts`. Return `{ error: { code, message } }` with status 400/401/403/409/500; never expose correct answers or secrets in error bodies.

- [ ] **Step 5: Verify handler and existing RingQuiz function tests**

  Run: `deno test --allow-env --allow-read supabase/functions/treasure-host-action/handler.test.ts supabase/functions/treasure-player-action/handler.test.ts`

  Run: `deno test --allow-read supabase/functions/submit-answer/mask-check.test.ts`

  Expected: all tests PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/functions/_shared/treasure-repository.ts supabase/functions/treasure-host-action supabase/functions/treasure-player-action
  git commit -m "feat: add Treasure Quiz action APIs"
  ```

### Task 5: Build Host setup, question editor and lobby

**Files:**
- Create: `treasure-quiz/src/domain/types.ts`
- Create: `treasure-quiz/src/lib/api.ts`
- Create: `treasure-quiz/src/store/gameStore.ts`
- Create: `treasure-quiz/src/hooks/useGameRealtime.ts`
- Create: `treasure-quiz/src/screens/host/HostLoginScreen.tsx`
- Create: `treasure-quiz/src/screens/host/HostSetupScreen.tsx`
- Create: `treasure-quiz/src/screens/host/QuestionEditor.tsx`
- Create: `treasure-quiz/src/screens/host/ChestSettingsEditor.tsx`
- Create: `treasure-quiz/src/screens/host/RewardCatalogEditor.tsx`
- Create: `treasure-quiz/src/screens/host/HostLobbyScreen.tsx`
- Test: `treasure-quiz/src/screens/host/HostSetupScreen.test.tsx`

**Interfaces:**
- Produces: `hostAction<T>(action: HostActionName, payload?: unknown): Promise<T>`
- Produces: `useGameRealtime(gameId: string | null): void`
- Consumes Task 4 Host action names and response shapes

- [ ] **Step 1: Write failing Host setup tests**

  Assert PIN error stays visible; question editor renders required counts per round; duplicated choices and missing keyword block Save; 49 questions disable Create Game; chest weights totaling 99 show an inline error; and valid setup invokes `create_game` exactly once on double tap.

- [ ] **Step 2: Run tests and confirm failure**

  Run: `npm --prefix treasure-quiz test -- --run src/screens/host/HostSetupScreen.test.tsx`

  Expected: FAIL because Host screens do not exist.

- [ ] **Step 3: Implement typed API, store and Realtime hook**

  Keep Host PIN in `sessionStorage`, not Zustand persistence. Realtime updates replace server-owned game fields; optimistic UI is allowed only for local form state.

- [ ] **Step 4: Implement Host screens**

  Use one focused mobile-first column: setup tabs for Questions, Chests and Rewards; a persistent validation summary; then a Lobby showing Player connection and one Start button.

- [ ] **Step 5: Verify Host tests and build**

  Run: `npm --prefix treasure-quiz test -- --run src/screens/host/HostSetupScreen.test.tsx`

  Run: `npm --prefix treasure-quiz run build`

  Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

  ```bash
  git add treasure-quiz/src
  git commit -m "feat: add Treasure Quiz host setup"
  ```

### Task 6: Build the eight-round Player and Host runtime

**Files:**
- Create: `treasure-quiz/src/components/ServerTimer.tsx`
- Create: `treasure-quiz/src/components/ResourceBar.tsx`
- Create: `treasure-quiz/src/components/questions/TrueFalseQuestion.tsx`
- Create: `treasure-quiz/src/components/questions/MultipleChoiceQuestion.tsx`
- Create: `treasure-quiz/src/components/questions/TimeBankRunner.tsx`
- Create: `treasure-quiz/src/components/questions/NoMistakeRunner.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerLoginScreen.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerBriefingScreen.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerQuestionScreen.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerRoundResultScreen.tsx`
- Create: `treasure-quiz/src/screens/host/HostGameScreen.tsx`
- Test: `treasure-quiz/src/components/questions/questionModes.test.tsx`
- Test: `treasure-quiz/src/screens/player/PlayerRuntime.test.tsx`

**Interfaces:**
- Produces: `ServerTimer({ deadline, onExpire })`
- Consumes: `playerAction('place_bet' | 'submit_answer' | 'restore_game', payload)`
- Consumes: Task 5 store and Realtime hook

- [ ] **Step 1: Write failing question-mode tests**

  Assert True/False and choices lock after one tap; time bank keeps one deadline across five questions; no-mistake stops on wrong answer; `mistake_shield` consumes once; and every answer control has an accessible name and keyboard activation.

- [ ] **Step 2: Write failing runtime/recovery tests**

  Assert briefing renders shuffled keywords but no question text; bet buttons disable when resources are insufficient; answer submission at deadline is blocked; reload calls `restore_game` and returns to briefing/question/result; Host sees submitted count but not hidden answer before reveal.

- [ ] **Step 3: Run tests and confirm failure**

  Run: `npm --prefix treasure-quiz test -- --run src/components/questions/questionModes.test.tsx src/screens/player/PlayerRuntime.test.tsx`

  Expected: FAIL because runtime screens do not exist.

- [ ] **Step 4: Implement the four question modes and server timer**

  Derive remaining time from `deadline - Date.now()`, resync after visibility/focus changes, and let Server rejection override local timing. Do not calculate correctness or rewards in the client.

- [ ] **Step 5: Implement Player and Host runtime screens**

  Map phases `waiting → briefing → playing → round_result` and repeat through round 8. Host controls start/reveal/advance; Player controls only bet and answer.

- [ ] **Step 6: Verify tests and full frontend suite**

  Run: `npm --prefix treasure-quiz test -- --run`

  Run: `npm --prefix treasure-quiz run build`

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add treasure-quiz/src
  git commit -m "feat: add Treasure Quiz round gameplay"
  ```

### Task 7: Add Event checkpoints

**Files:**
- Modify: `supabase/functions/treasure-player-action/handler.ts`
- Modify: `supabase/functions/treasure-player-action/handler.test.ts`
- Modify: `supabase/functions/_shared/treasure-game.ts`
- Modify: `supabase/functions/_shared/treasure-game.test.ts`
- Create: `treasure-quiz/src/screens/player/PlayerEventScreen.tsx`
- Create: `treasure-quiz/src/screens/host/HostEventScreen.tsx`
- Test: `treasure-quiz/src/screens/player/PlayerEventScreen.test.tsx`

**Interfaces:**
- Adds Player action: `buy_event` with choice `'skip' | 'gold' | 'diamond'`
- Produces Event codes listed in spec section 9 and a normalized `ActiveEffect[]`

- [ ] **Step 1: Write failing Event tests**

  Assert checkpoints occur only after rounds 2, 4 and 6; one purchase per checkpoint; Gold costs 150 and Diamond costs 1; insufficient balance is rejected; `bet_shield` and `mistake_shield` consume once; reward/time boosts expire after their specified next round(s).

- [ ] **Step 2: Run tests and confirm failure**

  Run: `deno test --allow-env --allow-read supabase/functions/_shared/treasure-game.test.ts supabase/functions/treasure-player-action/handler.test.ts`

  Run: `npm --prefix treasure-quiz test -- --run src/screens/player/PlayerEventScreen.test.tsx`

  Expected: FAIL for missing `buy_event` and Event screens.

- [ ] **Step 3: Implement Event action and persistence**

  Use server randomness and store the drawn code/effect in `tq_rounds`; Host and Player receive only the revealed result.

- [ ] **Step 4: Implement Event screens**

  Show Skip, Gold and Diamond as three clear choices, disable unaffordable choices, then reveal one card and its exact duration before Host advances.

- [ ] **Step 5: Verify all Event tests**

  Run: `deno test --allow-env --allow-read supabase/functions/_shared/treasure-game.test.ts supabase/functions/treasure-player-action/handler.test.ts`

  Run: `npm --prefix treasure-quiz test -- --run src/screens/player/PlayerEventScreen.test.tsx`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/functions treasure-quiz/src/screens
  git commit -m "feat: add Treasure Quiz event checkpoints"
  ```

### Task 8: Add multi-chest Prize Shop and persistent Wallet

**Files:**
- Modify: `supabase/functions/treasure-player-action/handler.ts`
- Modify: `supabase/functions/treasure-player-action/handler.test.ts`
- Create: `treasure-quiz/src/components/ChestCard.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerPrizeShopScreen.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerChestOpeningScreen.tsx`
- Create: `treasure-quiz/src/screens/player/PlayerWalletScreen.tsx`
- Create: `treasure-quiz/src/screens/host/HostChestScreen.tsx`
- Test: `treasure-quiz/src/screens/player/PlayerPrizeShopScreen.test.tsx`

**Interfaces:**
- Adds Player actions: `submit_chest_cart`, `open_chest`, `open_all_chests`, `get_wallet`
- `submit_chest_cart` consumes Task 3 `quoteChestCart`
- `open_chest` consumes Task 3 `drawWeightedReward`

- [ ] **Step 1: Write failing server tests**

  Assert a cart with remaining resources is rejected with a suggested completion; discount cannot target Copper/Closeout/Consolation; Crystal consumes exactly one gem; Closeout consumes 1–99 gold; zero-resource player receives one Consolation; double `open_chest` returns the first result and creates one Wallet entry.

- [ ] **Step 2: Write failing UI tests**

  Assert quantity changes update remaining resources; Confirm disables until both reach zero; Server suggestion can be applied; open-all reveals each purchased chest; Wallet displays satang as Thai baht without floating-point drift.

- [ ] **Step 3: Run tests and confirm failure**

  Run: `deno test --allow-env --allow-read supabase/functions/treasure-player-action/handler.test.ts`

  Run: `npm --prefix treasure-quiz test -- --run src/screens/player/PlayerPrizeShopScreen.test.tsx`

  Expected: FAIL for missing chest actions and Prize Shop screens.

- [ ] **Step 4: Implement atomic cart, chest and Wallet operations**

  Cart creation, chest opening and Wallet credit each use database transactions/RPCs. Save `result_satang` and `wallet_entry_id` on first open; idempotent retries return those values.

- [ ] **Step 5: Implement Prize Shop, reveal and Wallet screens**

  Keep the cart visible with Gold/Gem remaining totals. Provide open-one and open-all without changing the server result animation timing.

- [ ] **Step 6: Verify chest and Wallet tests**

  Run: `deno test --allow-env --allow-read supabase/functions/_shared/treasure-game.test.ts supabase/functions/treasure-player-action/handler.test.ts`

  Run: `npm --prefix treasure-quiz test -- --run src/screens/player/PlayerPrizeShopScreen.test.tsx`

  Expected: PASS.

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/functions treasure-quiz/src
  git commit -m "feat: add Treasure Quiz chests and wallet"
  ```

### Task 9: Add redemption, end-to-end recovery and private deployment

**Files:**
- Modify: `supabase/functions/treasure-host-action/handler.ts`
- Modify: `supabase/functions/treasure-player-action/handler.ts`
- Modify: `supabase/functions/treasure-host-action/handler.test.ts`
- Modify: `supabase/functions/treasure-player-action/handler.test.ts`
- Create: `treasure-quiz/src/screens/player/PlayerRewardsScreen.tsx`
- Create: `treasure-quiz/src/screens/host/HostRedemptionsScreen.tsx`
- Create: `treasure-quiz/playwright.config.ts`
- Create: `treasure-quiz/e2e/fixtures.ts`
- Create: `treasure-quiz/e2e/full-game.spec.ts`
- Create: `treasure-quiz/public/_redirects`
- Create after Sites registration: `treasure-quiz/.openai/hosting.json`

**Interfaces:**
- Adds Player action: `request_redemption`
- Adds Host actions: `complete_redemption`, `cancel_redemption`, `adjust_wallet`
- Produces statuses: `'pending' | 'completed' | 'cancelled'`

- [ ] **Step 1: Write failing redemption tests**

  Assert request does not deduct balance; completing checks balance then deducts once and appends one Wallet entry; insufficient balance at completion returns 409; cancelled cannot complete; completed cannot cancel; Host adjustment requires a non-empty reason and cannot make balance negative.

- [ ] **Step 2: Write the two-context E2E test**

  Use separate Host and Player browser contexts against local Supabase and served Edge Functions. Cover login, valid 50-question setup, one representative round of each mode while programmatically advancing the remaining rounds, all three Event checkpoints, Prize Shop zero balance, chest retry after reload, Wallet persistence into a new game, redemption completion, stale Player auth rejection after a new-device login, and answer buttons whose Playwright bounding boxes are at least 44px high at 320px viewport width.

- [ ] **Step 3: Run tests and confirm failure**

  Run: `deno test --allow-env --allow-read supabase/functions/treasure-host-action/handler.test.ts supabase/functions/treasure-player-action/handler.test.ts`

  Run: `npm --prefix treasure-quiz run test:e2e`

  Expected: FAIL for missing redemption, E2E fixtures and final routing.

- [ ] **Step 4: Implement redemption and final recovery paths**

  Add the two screens and actions. Ensure every app start calls `restore_game`; unopened purchased chests take precedence over a new game; pending redemption survives refresh.

- [ ] **Step 5: Run full verification**

  Run: `supabase test db supabase/tests/treasure_quiz_schema.test.sql`

  Run: `deno test --allow-env --allow-read supabase/functions/_shared/treasure-game.test.ts supabase/functions/treasure-host-action/handler.test.ts supabase/functions/treasure-player-action/handler.test.ts supabase/functions/submit-answer/mask-check.test.ts`

  Run: `npm --prefix treasure-quiz test -- --run`

  Run: `npm --prefix treasure-quiz run build`

  Run: `npm --prefix treasure-quiz run test:e2e`

  Expected: every command PASS.

- [ ] **Step 6: Register and package the separate Site**

  Use the Sites workflow to create a new private Site for `treasure-quiz`, persist the returned project ID in `.openai/hosting.json` with static directory `dist`, package the verified source, and keep RingQuiz deployment untouched.

- [ ] **Step 7: Deploy privately and verify**

  Deploy the saved Site version privately, wait for a successful deployment URL, and open it for Host-side QA. Do not change it to public audience; the user specified a private two-person game.

- [ ] **Step 8: Commit**

  ```bash
  git add treasure-quiz supabase/functions
  git commit -m "feat: finish Treasure Quiz private MVP"
  ```

---

## Final Acceptance Checklist

- [ ] RingQuiz production build and existing Deno tests still pass
- [ ] Treasure Quiz frontend unit tests, build and Playwright flow pass
- [ ] Supabase schema/RLS tests pass
- [ ] Host and Player can complete the game from separate browser contexts
- [ ] Every server deadline and retry path behaves deterministically
- [ ] Gold and gems equal zero after Prize Shop confirmation
- [ ] Each chest adds exactly one Wallet entry
- [ ] Wallet persists across a second game and formats satang correctly
- [ ] Redemption deducts only on Host completion
- [ ] Separate private deployment succeeds without changing RingQuiz URL or data
