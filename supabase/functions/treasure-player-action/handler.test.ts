import assert from 'node:assert/strict';
import { handlePlayerAction } from './handler.ts';
import type { PlayerDeps, TreasureRepository } from '../_shared/treasure-repository.ts';

function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

function makeRepository(overrides: Partial<TreasureRepository> = {}): TreasureRepository {
  return {
    authenticate: async () => 'auth-user-1',
    getProfile: async () => ({ id: 'profile-1', auth_user_id: null, display_name: 'Player', balance_satang: 0 }),
    linkProfile: async (input) => ({ id: 'profile-1', ...input }),
    getActiveGame: async () => ({ id: 'game-1', phase: 'briefing', gold: 200, gems: 1, player_profile_id: 'profile-1' }),
    getGame: async () => ({ id: 'game-1', phase: 'briefing', gold: 200, gems: 1, player_profile_id: 'profile-1' }),
    getRound: async () => ({ id: 'round-1', game_id: 'game-1', round_no: 1, phase: 'briefing', bet_type: 'safe', stake_gold: 0, stake_gems: 0 }),
    getQuestion: async () => ({ id: 'q-1', correct_answer: 'A', choices: ['A', 'B'], prompt: 'Q', keyword: 'K' }),
    getAnswer: async () => null,
    placeBet: async (input) => ({ id: 'bet-1', ...input }),
    updateGame: async (_id, patch) => ({ id: 'game-1', ...patch }),
    insertAnswer: async (input) => ({ id: 'answer-1', ...input }),
    ...overrides,
  };
}

function deps(overrides: Partial<TreasureRepository> = {}): PlayerDeps {
  return { playerPin: '5678', repository: makeRepository(overrides) };
}

Deno.test('link_profile replaces the prior auth UID', async () => {
  let linked: Record<string, unknown> | undefined;
  const response = await handlePlayerAction({ action: 'link_profile', pin: '5678', accessToken: 'jwt', authUserId: 'new-user' }, deps({
    linkProfile: async (input) => {
      linked = input;
      return { id: 'profile-1', ...input };
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(linked?.authUserId, 'new-user');
});

Deno.test('Gold stake cannot make resources negative', async () => {
  const response = await handlePlayerAction({ action: 'place_bet', accessToken: 'jwt', payload: { gameId: 'game-1', roundNo: 1, betType: 'gold' } }, deps({
    getGame: async () => ({ id: 'game-1', phase: 'briefing', gold: 50, gems: 0, player_profile_id: 'profile-1' }),
  }));
  assert.equal(response.status, 409);
  assert.equal((await json(response)).error.code, 'insufficient_gold');
});

Deno.test('duplicate place_bet returns the original result', async () => {
  const original = { id: 'bet-1', game_id: 'game-1', round_no: 1, bet_type: 'gold', stake_gold: 100, stake_gems: 0 };
  const response = await handlePlayerAction({ action: 'place_bet', accessToken: 'jwt', payload: { gameId: 'game-1', roundNo: 1, betType: 'gold' } }, deps({
    getRound: async () => ({ ...original }),
  }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.already_submitted, true);
  assert.equal(body.bet.id, 'bet-1');
});

Deno.test('late answer returns 409 and does not insert a row', async () => {
  let inserted = false;
  const response = await handlePlayerAction({ action: 'submit_answer', accessToken: 'jwt', payload: { gameId: 'game-1', roundNo: 1, questionId: 'q-1', answer: 'A', now: '2026-10-08T12:00:11.000Z' } }, deps({
    getRound: async () => ({ id: 'round-1', game_id: 'game-1', round_no: 1, phase: 'playing', deadline: '2026-10-08T12:00:10.000Z' }),
    insertAnswer: async (input) => {
      inserted = true;
      return { id: 'answer-1', ...input };
    },
  }));
  assert.equal(response.status, 409);
  assert.equal(inserted, false);
});

Deno.test('current question response omits correct answer and unrevealed settlement fields', async () => {
  const response = await handlePlayerAction({ action: 'restore_game', accessToken: 'jwt', payload: { gameId: 'game-1' } }, deps({
    getQuestion: async () => ({ id: 'q-1', correct_answer: 'A', prompt: 'Q', keyword: 'K', choices: ['A', 'B'] }),
  }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.question.correct_answer, undefined);
  assert.equal(body.round?.correct_count, undefined);
  assert.equal(body.round?.base_reward_gold, undefined);
});

Deno.test('buy_event only works at checkpoints and spends exactly one resource bundle', async () => {
  let updatedGame: Record<string, unknown> | undefined;
  const response = await handlePlayerAction({ action: 'buy_event', accessToken: 'jwt', payload: { gameId: 'game-1', choice: 'gold' } }, deps({
    getGame: async () => ({ id: 'game-1', phase: 'event', current_round: 2, gold: 200, gems: 0, player_profile_id: 'profile-1' }),
    getRound: async () => ({ id: 'round-1', game_id: 'game-1', round_no: 2, phase: 'event', event_choice: null }),
    updateRound: async (_id, patch) => ({ id: 'round-1', ...patch }),
    updateGame: async (_id, patch) => { updatedGame = patch; return { id: 'game-1', phase: 'event', ...patch }; },
  }));
  assert.equal(response.status, 200);
  assert.equal(updatedGame?.gold, 50);
});

Deno.test('buy_event rejects non-checkpoint and insufficient balance', async () => {
  const nonCheckpoint = await handlePlayerAction({ action: 'buy_event', accessToken: 'jwt', payload: { gameId: 'game-1', choice: 'gold' } }, deps({
    getGame: async () => ({ id: 'game-1', phase: 'playing', current_round: 3, gold: 500, gems: 0, player_profile_id: 'profile-1' }),
  }));
  assert.equal(nonCheckpoint.status, 409);
  const insufficient = await handlePlayerAction({ action: 'buy_event', accessToken: 'jwt', payload: { gameId: 'game-1', choice: 'diamond' } }, deps({
    getGame: async () => ({ id: 'game-1', phase: 'event', current_round: 4, gold: 500, gems: 0, player_profile_id: 'profile-1' }),
  }));
  assert.equal(insufficient.status, 409);
  assert.equal((await insufficient.json()).error.code, 'insufficient_gems');
});

Deno.test('submit_chest_cart rejects a cart that leaves resources and gives a completion suggestion', async () => {
  const response = await handlePlayerAction({ action: 'submit_chest_cart', accessToken: 'jwt', payload: { gameId: 'game-1', cart: [{ key: 'copper', quantity: 1 }] } }, deps({
    getGame: async () => ({ id: 'game-1', phase: 'prize_shop', gold: 250, gems: 0, player_profile_id: 'profile-1' }),
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'incomplete_chest_cart');
});

Deno.test('open_chest is idempotent and returns the first wallet result', async () => {
  let openCount = 0;
  const first = { id: 'open-1', status: 'opened', result_satang: 100, wallet_entry_id: 'wallet-1' };
  const response = await handlePlayerAction({ action: 'open_chest', accessToken: 'jwt', payload: { gameId: 'game-1', chestOpenId: 'open-1' } }, deps({
    getChestOpen: async () => first,
    openChest: async () => { openCount += 1; return first; },
  }));
  assert.equal(response.status, 200);
  assert.equal(openCount, 0);
  assert.equal((await response.json()).chest.result_satang, 100);
});

Deno.test('get_wallet returns integer satang entries', async () => {
  const response = await handlePlayerAction({ action: 'get_wallet', accessToken: 'jwt', payload: {} }, deps({
    getWallet: async () => ({ balanceSatang: 101, entries: [{ amount_satang: 1 }] }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).wallet.balanceSatang, 101);
});

Deno.test('zero-resource Player receives one consolation chest', async () => {
  let received: unknown[] = [];
  const response = await handlePlayerAction({ action: 'submit_chest_cart', accessToken: 'jwt', payload: { gameId: 'game-1', cart: [] } }, deps({
    getGame: async () => ({ id: 'game-1', phase: 'prize_shop', gold: 0, gems: 0, player_profile_id: 'profile-1' }),
    submitChestCart: async (input) => { received = input.cart; return [{ id: 'open-1', chest_key: 'consolation' }]; },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(received, [{ key: 'consolation', quantity: 1 }]);
});
