import { corsHeaders } from '../_shared/cors.ts';
import { validateQuestionSet } from '../_shared/treasure-game.ts';
import type { QuestionDefinition } from '../_shared/treasure-types.ts';
import type { HostDeps, TqGame } from '../_shared/treasure-repository.ts';

export type HostAction =
  | 'save_question'
  | 'save_chest_type'
  | 'save_reward_item'
  | 'create_game'
  | 'start_game'
  | 'open_briefing'
  | 'start_round'
  | 'reveal_round'
  | 'advance_phase'
  | 'pause_game'
  | 'resume_game';

export interface HostActionRequest {
  action: HostAction | string;
  pin: string;
  payload?: Record<string, unknown>;
}

function ok(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function fail(status: number, code: string, message: string): Response {
  return ok({ error: { code, message } }, status);
}

function payloadQuestion(payload: Record<string, unknown>): QuestionDefinition {
  return {
    roundNo: Number(payload.roundNo),
    position: Number(payload.position),
    questionType: payload.questionType as QuestionDefinition['questionType'],
    prompt: String(payload.prompt ?? ''),
    keyword: String(payload.keyword ?? ''),
    choices: Array.isArray(payload.choices) ? payload.choices.map(String) : [],
    correctAnswer: String(payload.correctAnswer ?? ''),
    difficulty: Number(payload.difficulty ?? 1),
  };
}

async function requireGame(deps: HostDeps, gameId?: string): Promise<TqGame | null> {
  if (gameId && deps.repository.getGame) return deps.repository.getGame(gameId);
  return deps.repository.getActiveGame?.() ?? null;
}

export async function handleHostAction(request: HostActionRequest, deps: HostDeps): Promise<Response> {
  if (!deps.hostPin || request.pin !== deps.hostPin) return fail(401, 'unauthorized', 'Invalid Host PIN');
  const repo = deps.repository;
  const payload = request.payload ?? {};

  try {
    switch (request.action) {
      case 'save_question': {
        if (!repo.saveQuestion) return fail(500, 'repository_method_missing', 'Question repository is not configured');
        const saved = await repo.saveQuestion(payloadQuestion(payload));
        return ok({ ok: true, question: saved });
      }
      case 'save_chest_type': {
        if (!repo.saveChestType) return fail(500, 'repository_method_missing', 'Chest repository is not configured');
        return ok({ ok: true, chest: await repo.saveChestType(payload as never) });
      }
      case 'save_reward_item': {
        if (!repo.saveRewardItem) return fail(500, 'repository_method_missing', 'Reward repository is not configured');
        return ok({ ok: true, reward: await repo.saveRewardItem(payload) });
      }
      case 'create_game': {
        if (!repo.getQuestionDefinitions || !repo.createGame) return fail(500, 'repository_method_missing', 'Game repository is not configured');
        if (await repo.getActiveGame?.()) return fail(409, 'active_game_exists', 'An active game already exists');
        const questions = await repo.getQuestionDefinitions();
        const validation = validateQuestionSet(questions);
        if (!validation.ok) return fail(400, 'invalid_question_set', validation.errors.join('; '));
        const profile = await repo.getProfile?.();
        const game = await repo.createGame({
          playerProfileId: String(payload.playerProfileId ?? profile?.id ?? 'singleton'),
          gold: Number(payload.gold ?? 200),
          gems: Number(payload.gems ?? 0),
          configSnapshot: payload.configSnapshot ?? { questionCount: questions.length, rounds: 8 },
        });
        return ok({ ok: true, game });
      }
      case 'start_game':
      case 'open_briefing':
      case 'pause_game':
      case 'resume_game': {
        const game = await requireGame(deps, String(payload.gameId ?? ''));
        if (!game || !repo.updateGame) return fail(404, 'game_not_found', 'Game not found');
        const phase = request.action === 'start_game' || request.action === 'resume_game'
          ? 'briefing'
          : request.action === 'pause_game' ? 'waiting' : 'briefing';
        const updated = await repo.updateGame(game.id, { phase });
        return ok({ ok: true, game: updated });
      }
      case 'start_round': {
        const game = await requireGame(deps, String(payload.gameId ?? ''));
        if (!game || !repo.updateGame) return fail(404, 'game_not_found', 'Game not found');
        const roundNo = Number(payload.roundNo ?? Number(game.current_round ?? 0) + 1);
        const updated = await repo.updateGame(game.id, { phase: 'playing', current_round: roundNo });
        const round = repo.getRound ? await repo.getRound(game.id, roundNo) : null;
        const createdRound = round ?? (repo.createRound ? await repo.createRound(game.id, roundNo) : null);
        return ok({ ok: true, game: updated, round: createdRound });
      }
      case 'reveal_round': {
        const game = await requireGame(deps, String(payload.gameId ?? ''));
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        if (!repo.revealRound) return fail(500, 'repository_method_missing', 'Reveal repository is not configured');
        const round = await repo.revealRound(game.id, Number(payload.roundNo ?? game.current_round ?? 1));
        return ok({ ok: true, round });
      }
      case 'advance_phase': {
        const game = await requireGame(deps, String(payload.gameId ?? ''));
        if (!game || !repo.updateGame) return fail(404, 'game_not_found', 'Game not found');
        const phase = String(payload.phase ?? 'briefing');
        return ok({ ok: true, game: await repo.updateGame(game.id, { phase }) });
      }
      default:
        return fail(400, 'unknown_action', 'Unknown Host action');
    }
  } catch (error) {
    console.error('[treasure-host-action]', error);
    return fail(500, 'internal', 'Treasure Quiz action failed');
  }
}
