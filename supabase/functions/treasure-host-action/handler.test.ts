import assert from 'node:assert/strict';
import { handleHostAction } from './handler.ts';
import type { HostDeps, TreasureRepository } from '../_shared/treasure-repository.ts';

function responseJson(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

function makeRepository(overrides: Partial<TreasureRepository> = {}): TreasureRepository {
  return {
    getActiveGame: async () => null,
    getQuestionDefinitions: async () => [],
    createGame: async (input) => ({ id: 'game-1', phase: 'waiting', ...input }),
    getGame: async () => ({ id: 'game-1', phase: 'waiting', gold: 200, gems: 0 }),
    updateGame: async (_id, patch) => ({ id: 'game-1', phase: 'waiting', ...patch }),
    ...overrides,
  };
}

function deps(overrides: Partial<TreasureRepository> = {}): HostDeps {
  return { hostPin: '1234', repository: makeRepository(overrides) };
}

Deno.test('wrong Host PIN returns structured 401', async () => {
  const response = await handleHostAction({ action: 'create_game', pin: 'wrong' }, deps());
  assert.equal(response.status, 401);
  assert.deepEqual(await responseJson(response), { error: { code: 'unauthorized', message: 'Invalid Host PIN' } });
});

Deno.test('create_game rejects invalid 50-question setup', async () => {
  const response = await handleHostAction({ action: 'create_game', pin: '1234' }, deps({
    getQuestionDefinitions: async () => [],
  }));
  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).error.code, 'invalid_question_set');
});

Deno.test('create_game persists custom round settings and accepts their question counts', async () => {
  const roundSettings = Array.from({ length: 8 }, (_, index) => ({
    roundNo: index + 1,
    questionType: index < 2 ? 'true_false' : index < 4 ? 'multiple_choice' : index < 6 ? 'time_bank' : 'no_mistake',
    questionCount: 1,
    timingMode: 'per_question',
    timeLimitSec: 15,
    noMistake: index >= 6,
  }));
  const questions = roundSettings.map((setting) => ({
    roundNo: setting.roundNo,
    position: 1,
    questionType: setting.questionType,
    prompt: `Q${setting.roundNo}`,
    keyword: `K${setting.roundNo}`,
    choices: setting.questionType === 'true_false' ? ['ใช่', 'ไม่ใช่'] : ['A', 'B', 'C'],
    correctAnswer: setting.questionType === 'true_false' ? 'ใช่' : 'A',
    difficulty: 1,
  }));
  let createdInput: any;
  const response = await handleHostAction({ action: 'create_game', pin: '1234', payload: { questions, configSnapshot: { roundSettings } } }, deps({
    getQuestionDefinitions: async () => questions,
    saveQuestion: async (question) => question,
    createGame: async (input) => { createdInput = input; return { id: 'game-1', phase: 'waiting', ...input }; },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(createdInput.configSnapshot.roundSettings, roundSettings);
});

Deno.test('get_setup returns the active game so a Host can resume after refresh', async () => {
  const activeGame = { id: 'existing', phase: 'waiting', current_round: 0 };
  const response = await handleHostAction({ action: 'get_setup', pin: '1234' }, deps({
    getActiveGame: async () => activeGame,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual((await responseJson(response)).activeGame, activeGame);
});

Deno.test('create_game returns the active game idempotently instead of a 409', async () => {
  const activeGame = { id: 'existing', phase: 'waiting', current_round: 0 };
  let createCalls = 0;
  const response = await handleHostAction({ action: 'create_game', pin: '1234' }, deps({
    getActiveGame: async () => activeGame,
    createGame: async (input) => {
      createCalls += 1;
      return { id: 'new-game', phase: 'waiting', ...input };
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true, game: activeGame, reused: true });
  assert.equal(createCalls, 0);
});

Deno.test('Host completes and cancels redemptions through repository state transitions', async () => {
  const complete = await handleHostAction({ action: 'complete_redemption', pin: '1234', payload: { redemptionId: 'redemption-1' } }, deps({
    completeRedemption: async (id) => ({ id, status: 'completed', cost_satang: 10000 }),
  }));
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).redemption.status, 'completed');
  const cancel = await handleHostAction({ action: 'cancel_redemption', pin: '1234', payload: { redemptionId: 'redemption-2' } }, deps({
    cancelRedemption: async (id) => ({ id, status: 'cancelled' }),
  }));
  assert.equal(cancel.status, 200);
});

Deno.test('wallet adjustment requires a reason', async () => {
  const response = await handleHostAction({ action: 'adjust_wallet', pin: '1234', payload: { amountSatang: 100 } }, deps());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'reason_required');
});
