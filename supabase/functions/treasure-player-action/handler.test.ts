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
