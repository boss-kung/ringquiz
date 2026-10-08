import { corsHeaders } from '../_shared/cors.ts';
import { isEventCheckpoint, normalizeRoundSettings, validateQuestionSet, validateRoundSettings } from '../_shared/treasure-game.ts';
import type { QuestionDefinition } from '../_shared/treasure-types.ts';
import type { HostDeps, TqGame } from '../_shared/treasure-repository.ts';

export type HostAction =
  | 'get_setup'
  | 'save_question'
  | 'save_chest_type'
  | 'delete_chest_type'
  | 'save_reward_item'
  | 'delete_reward_item'
  | 'create_game'
  | 'start_game'
  | 'open_briefing'
  | 'start_round'
  | 'reveal_round'
  | 'advance_phase'
  | 'pause_game'
  | 'resume_game'
  | 'get_redemptions'
  | 'complete_redemption'
  | 'cancel_redemption'
  | 'adjust_wallet';

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

function roundDurationSeconds(roundNo: number, game: TqGame, questionCount: number): number {
  const config = game.config_snapshot && typeof game.config_snapshot === 'object' ? game.config_snapshot as Record<string, unknown> : {};
  const settings = normalizeRoundSettings(config.roundSettings);
  const setting = settings.find((item) => item.roundNo === roundNo) ?? settings[roundNo - 1];
  return setting.timingMode === 'per_question' ? setting.timeLimitSec * questionCount : setting.timeLimitSec;
}

function sanitizeQuestion(question: Record<string, unknown>): Record<string, unknown> {
  const { correctAnswer: _camel, correct_answer: _snake, ...safe } = question;
  return safe;
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
      case 'get_setup': {
        const questions = repo.getQuestionDefinitions ? await repo.getQuestionDefinitions() : [];
        const chests = repo.getChestTypes ? await repo.getChestTypes() : [];
        const rewards = (repo.getRewardCatalog ? await repo.getRewardCatalog() : []).map((reward: Record<string, unknown>) => ({
          id: String(reward.id ?? ''),
          title: String(reward.title ?? ''),
          rewardKind: String(reward.rewardKind ?? reward.reward_kind ?? 'cash') as 'cash' | 'experience',
          costSatang: Number(reward.costSatang ?? reward.cost_satang ?? 0),
        }));
        const roundSettings = normalizeRoundSettings(undefined).map((setting) => {
          const roundQuestions = questions.filter((question: Record<string, unknown>) => Number(question.roundNo ?? question.round_no) === setting.roundNo);
          const firstType = roundQuestions[0]?.questionType ?? roundQuestions[0]?.question_type;
          return { ...setting, questionCount: roundQuestions.length || setting.questionCount, questionType: firstType ?? setting.questionType, noMistake: firstType === 'no_mistake' || setting.noMistake };
        });
        return ok({ ok: true, questions, chests, rewards, roundSettings });
      }
      case 'save_question': {
        if (!repo.saveQuestion) return fail(500, 'repository_method_missing', 'Question repository is not configured');
        const saved = await repo.saveQuestion(payloadQuestion(payload));
        return ok({ ok: true, question: saved });
      }
      case 'save_chest_type': {
        if (!repo.saveChestType) return fail(500, 'repository_method_missing', 'Chest repository is not configured');
        return ok({ ok: true, chest: await repo.saveChestType(payload as never) });
      }
      case 'delete_chest_type': {
        if (!repo.deactivateChestType) return fail(500, 'repository_method_missing', 'Chest repository is not configured');
        const key = String(payload.key ?? '');
        if (!key) return fail(400, 'chest_key_required', 'Chest key is required');
        return ok({ ok: true, chest: await repo.deactivateChestType(key) });
      }
      case 'save_reward_item': {
        if (!repo.saveRewardItem) return fail(500, 'repository_method_missing', 'Reward repository is not configured');
        return ok({ ok: true, reward: await repo.saveRewardItem(payload) });
      }
      case 'delete_reward_item': {
        if (!repo.deactivateRewardItem) return fail(500, 'repository_method_missing', 'Reward repository is not configured');
        const id = String(payload.id ?? '');
        if (!id) return fail(400, 'reward_id_required', 'Reward ID is required');
        return ok({ ok: true, reward: await repo.deactivateRewardItem(id) });
      }
      case 'create_game': {
        if (!repo.getQuestionDefinitions || !repo.createGame) return fail(500, 'repository_method_missing', 'Game repository is not configured');
        if (await repo.getActiveGame?.()) return fail(409, 'active_game_exists', 'An active game already exists');
        const configSnapshot = payload.configSnapshot && typeof payload.configSnapshot === 'object' ? payload.configSnapshot as Record<string, unknown> : {};
        const roundSettings = normalizeRoundSettings(configSnapshot.roundSettings);
        const settingsValidation = validateRoundSettings(roundSettings);
        if (!settingsValidation.ok) return fail(400, 'invalid_round_settings', settingsValidation.errors.join('; '));
        const submittedQuestions = Array.isArray(payload.questions) ? payload.questions.map((question) => payloadQuestion(question as Record<string, unknown>)) : [];
        if (submittedQuestions.length > 0) {
          const submittedValidation = validateQuestionSet(submittedQuestions, roundSettings);
          if (!submittedValidation.ok) return fail(400, 'invalid_question_set', submittedValidation.errors.join('; '));
          if (repo.saveQuestion) for (const question of submittedQuestions) await repo.saveQuestion(question);
          if (repo.deactivateQuestionsAfter) for (const setting of roundSettings) await repo.deactivateQuestionsAfter(setting.roundNo, setting.questionCount);
        }
        if (Array.isArray(payload.chests) && repo.saveChestType) {
          for (const chest of payload.chests) await repo.saveChestType(chest as never);
        }
        if (Array.isArray(payload.removedChestKeys) && repo.deactivateChestType) {
          for (const key of payload.removedChestKeys) await repo.deactivateChestType(String(key));
        }
        if (Array.isArray(payload.rewards) && repo.saveRewardItem) {
          for (const reward of payload.rewards) await repo.saveRewardItem(reward as Record<string, unknown>);
        }
        if (Array.isArray(payload.removedRewardIds) && repo.deactivateRewardItem) {
          for (const id of payload.removedRewardIds) await repo.deactivateRewardItem(String(id));
        }
        const questions = submittedQuestions.length > 0 ? submittedQuestions : await repo.getQuestionDefinitions();
        const validation = validateQuestionSet(questions, roundSettings);
        if (!validation.ok) return fail(400, 'invalid_question_set', validation.errors.join('; '));
        const profile = await repo.getProfile?.();
        const game = await repo.createGame({
          playerProfileId: String(payload.playerProfileId ?? profile?.id ?? 'singleton'),
          gold: Number(payload.gold ?? 200),
          gems: Number(payload.gems ?? 0),
          configSnapshot: { ...configSnapshot, roundSettings },
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
        const requestedRound = Number(payload.roundNo);
        const currentRound = Number(game.current_round ?? 0);
        const roundNo = Number.isInteger(requestedRound) && requestedRound > currentRound ? requestedRound : currentRound + 1;
        const startedAt = new Date();
        const roundQuestions = repo.getQuestionsForRound ? await repo.getQuestionsForRound(roundNo) : [];
        const deadline = new Date(startedAt.getTime() + roundDurationSeconds(roundNo, game, roundQuestions.length) * 1000);
        const previousRound = roundNo > 1 && repo.getRound ? await repo.getRound(game.id, roundNo - 1) : null;
        const inheritedEffects = Array.isArray(previousRound?.active_effects) ? previousRound?.active_effects : [];
        const updated = await repo.updateGame(game.id, { phase: 'playing', current_round: roundNo });
        const round = repo.getRound ? await repo.getRound(game.id, roundNo) : null;
        const createdRound = round
          ? repo.updateRound ? await repo.updateRound(round.id, { phase: 'playing', started_at: startedAt.toISOString(), deadline: deadline.toISOString(), active_effects: inheritedEffects }) : round
          : repo.createRound ? await repo.createRound(game.id, roundNo, { phase: 'playing', started_at: startedAt.toISOString(), deadline: deadline.toISOString(), active_effects: inheritedEffects }) : null;
        return ok({ ok: true, game: updated, round: createdRound, questions: roundQuestions.map((question) => sanitizeQuestion(question as unknown as Record<string, unknown>)) });
      }
      case 'reveal_round': {
        const game = await requireGame(deps, String(payload.gameId ?? ''));
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        if (!repo.revealRound) return fail(500, 'repository_method_missing', 'Reveal repository is not configured');
        const round = await repo.revealRound(game.id, Number(payload.roundNo ?? game.current_round ?? 1));
        return ok({ ok: true, round, game: repo.getGame ? await repo.getGame(game.id) : undefined });
      }
      case 'advance_phase': {
        const game = await requireGame(deps, String(payload.gameId ?? ''));
        if (!game || !repo.updateGame) return fail(404, 'game_not_found', 'Game not found');
        const phase = String(payload.phase ?? 'briefing');
        return ok({ ok: true, game: await repo.updateGame(game.id, { phase }) });
      }
      case 'complete_redemption': {
        if (!repo.completeRedemption) return fail(500, 'repository_method_missing', 'Redemption repository is not configured');
        const redemptionId = String(payload.redemptionId ?? '');
        if (!redemptionId) return fail(400, 'redemption_id_required', 'Redemption ID is required');
        return ok({ ok: true, redemption: await repo.completeRedemption(redemptionId) });
      }
      case 'cancel_redemption': {
        if (!repo.cancelRedemption) return fail(500, 'repository_method_missing', 'Redemption repository is not configured');
        const redemptionId = String(payload.redemptionId ?? '');
        if (!redemptionId) return fail(400, 'redemption_id_required', 'Redemption ID is required');
        return ok({ ok: true, redemption: await repo.cancelRedemption(redemptionId) });
      }
      case 'adjust_wallet': {
        const reason = String(payload.reason ?? '').trim();
        if (!reason) return fail(400, 'reason_required', 'A wallet adjustment reason is required');
        const amountSatang = Number(payload.amountSatang);
        if (!Number.isInteger(amountSatang) || amountSatang === 0) return fail(400, 'invalid_amount', 'Amount must be a non-zero integer satang value');
        if (!repo.adjustWallet) return fail(500, 'repository_method_missing', 'Wallet repository is not configured');
        const profile = await repo.getProfile?.();
        if (!profile) return fail(404, 'profile_not_found', 'Player profile not found');
        return ok({ ok: true, wallet: await repo.adjustWallet({ profileId: String(payload.profileId ?? profile.id), amountSatang, reason }) });
      }
      case 'get_redemptions': {
        if (!repo.getRedemptions) return fail(500, 'repository_method_missing', 'Redemption repository is not configured');
        return ok({ ok: true, redemptions: await repo.getRedemptions() });
      }
      default:
        return fail(400, 'unknown_action', 'Unknown Host action');
    }
  } catch (error) {
    console.error('[treasure-host-action]', error);
    const message = error instanceof Error ? error.message : String(error);
    if (/insufficient wallet/i.test(message)) return fail(409, 'insufficient_wallet', 'Wallet balance is not enough to complete this redemption');
    if (/cannot be (completed|cancelled)/i.test(message)) return fail(409, 'invalid_redemption_state', 'Redemption is already finalized');
    return fail(500, 'internal', 'Treasure Quiz action failed');
  }
}
