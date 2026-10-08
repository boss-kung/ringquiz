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

Deno.test('second active game returns 409', async () => {
  const questions = Array.from({ length: 50 }, (_, index) => ({
    roundNo: index < 10 ? 1 : index < 20 ? 2 : Math.floor((index - 20) / 5) + 3,
    position: index < 20 ? (index % 10) + 1 : (index % 5) + 1,
    questionType: index < 20 ? 'true_false' : 'multiple_choice',
    prompt: `Q${index}`,
    keyword: `K${index}`,
    choices: ['A', 'B'],
    correctAnswer: 'A',
    difficulty: 1,
  }));
  const response = await handleHostAction({ action: 'create_game', pin: '1234' }, deps({
    getActiveGame: async () => ({ id: 'existing', phase: 'waiting' }),
    getQuestionDefinitions: async () => questions,
  }));
  assert.equal(response.status, 409);
  assert.equal((await responseJson(response)).error.code, 'active_game_exists');
});
