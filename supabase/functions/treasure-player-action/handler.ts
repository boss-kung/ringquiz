import { corsHeaders } from '../_shared/cors.ts';
import type { BetType } from '../_shared/treasure-types.ts';
import type { PlayerDeps, TqGame, TqQuestion, TqRound } from '../_shared/treasure-repository.ts';

export type PlayerAction = 'link_profile' | 'join_game' | 'place_bet' | 'submit_answer' | 'restore_game';

export interface PlayerActionRequest {
  action: PlayerAction | string;
  pin?: string;
  accessToken?: string;
  authUserId?: string;
  payload?: Record<string, unknown>;
}

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function fail(status: number, code: string, message: string): Response {
  return reply({ error: { code, message } }, status);
}

async function authenticate(request: PlayerActionRequest, deps: PlayerDeps): Promise<string | null> {
  if (request.authUserId) return request.authUserId;
  if (!request.accessToken || !deps.repository.authenticate) return null;
  return deps.repository.authenticate(request.accessToken);
}

function sanitizeQuestion(question: TqQuestion | null): Record<string, unknown> | null {
  if (!question) return null;
  const { correctAnswer: _correctAnswer, correct_answer: _correctAnswerSnake, ...safe } = question;
  return safe;
}

function sanitizeRound(round: TqRound | null): Record<string, unknown> | null {
  if (!round) return null;
  const { correct_count: _correct, answered_count: _answered, base_reward_gold: _base, bonus_reward_gold: _bonus, achievement_gems: _gems, ...safe } = round;
  return safe;
}

export async function handlePlayerAction(request: PlayerActionRequest, deps: PlayerDeps): Promise<Response> {
  const repo = deps.repository;
  const payload = request.payload ?? {};

  if (request.action === 'link_profile') {
    if (request.pin !== deps.playerPin) return fail(401, 'unauthorized', 'Invalid Player PIN');
    const authUserId = await authenticate(request, deps);
    if (!authUserId || !repo.linkProfile) return fail(401, 'unauthorized', 'Valid Player session required');
    try {
      const profile = await repo.linkProfile({ authUserId, displayName: payload.displayName ? String(payload.displayName) : undefined });
      return reply({ ok: true, profile });
    } catch (error) {
      console.error('[treasure-player-link]', error);
      return fail(500, 'internal', 'Unable to link Player profile');
    }
  }

  const authUserId = await authenticate(request, deps);
  if (!authUserId) return fail(401, 'unauthorized', 'Valid Player session required');

  try {
    const profile = repo.getProfile ? await repo.getProfile(authUserId) : null;
    if (!profile) return fail(403, 'profile_not_linked', 'Link this Player device first');

    switch (request.action) {
      case 'join_game': {
        const game = payload.gameId && repo.getGame
          ? await repo.getGame(String(payload.gameId))
          : await repo.getActiveGame?.();
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        const joined = repo.joinGame ? await repo.joinGame(game.id, profile.id) : game;
        return reply({ ok: true, game: joined });
      }
      case 'place_bet': {
        if (!repo.getGame || !repo.getRound || !repo.placeBet || !repo.updateGame) return fail(500, 'repository_method_missing', 'Bet repository is not configured');
        const game = await repo.getGame(String(payload.gameId ?? ''));
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        const roundNo = Number(payload.roundNo);
        const existing = await repo.getRound(game.id, roundNo);
        if (existing && existing.bet_type && existing.bet_type !== 'safe' && (existing.stake_gold ?? 0) + (existing.stake_gems ?? 0) > 0) {
          return reply({ ok: true, already_submitted: true, bet: existing });
        }
        const betType = String(payload.betType ?? 'safe') as BetType;
        const stakeGold = betType === 'gold' ? 100 : 0;
        const stakeGems = betType === 'diamond' ? 1 : 0;
        if ((game.gold ?? 0) < stakeGold) return fail(409, 'insufficient_gold', 'Not enough gold for this bet');
        if ((game.gems ?? 0) < stakeGems) return fail(409, 'insufficient_gems', 'Not enough gems for this bet');
        const bet = await repo.placeBet({ gameId: game.id, roundNo, betType, stakeGold, stakeGems });
        const updatedGame = await repo.updateGame(game.id, { gold: (game.gold ?? 0) - stakeGold, gems: (game.gems ?? 0) - stakeGems });
        return reply({ ok: true, already_submitted: false, bet, game: updatedGame });
      }
      case 'submit_answer': {
        if (!repo.getRound || !repo.getQuestion || !repo.getAnswer || !repo.insertAnswer) return fail(500, 'repository_method_missing', 'Answer repository is not configured');
        const gameId = String(payload.gameId ?? '');
        const roundNo = Number(payload.roundNo);
        const questionId = String(payload.questionId ?? '');
        const round = await repo.getRound(gameId, roundNo);
        if (!round) return fail(404, 'round_not_found', 'Round not found');
        const existing = await repo.getAnswer(gameId, roundNo, questionId);
        if (existing) return reply({ ok: true, already_submitted: true, answer: existing });
        if (round.deadline) {
          const nowValue = payload.now ? Date.parse(String(payload.now)) : Date.now();
          if (!Number.isFinite(nowValue) || nowValue >= Date.parse(round.deadline)) return fail(409, 'time_expired', 'Answer deadline has passed');
        }
        const question = await repo.getQuestion(questionId);
        if (!question) return fail(404, 'question_not_found', 'Question not found');
        const submitted = payload.answer;
        const isCorrect = JSON.stringify(submitted) === JSON.stringify(question.correctAnswer);
        const answer = await repo.insertAnswer({ gameId, roundNo, questionId, answer: submitted, isCorrect, responseMs: payload.responseMs ? Number(payload.responseMs) : undefined });
        return reply({ ok: true, already_submitted: false, answer: { id: answer.id, is_correct: isCorrect } });
      }
      case 'restore_game': {
        const game = payload.gameId && repo.getGame ? await repo.getGame(String(payload.gameId)) : await repo.getActiveGame?.();
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        const roundNo = Number(game.current_round ?? 1);
        const round = repo.getRound ? await repo.getRound(game.id, roundNo) : null;
        const question = repo.getCurrentQuestion
          ? await repo.getCurrentQuestion(game.id, roundNo)
          : repo.getQuestion ? await repo.getQuestion(String(game.current_question_id ?? payload.questionId ?? 'current-question')) : null;
        return reply({ ok: true, game, round: sanitizeRound(round), question: sanitizeQuestion(question) });
      }
      default:
        return fail(400, 'unknown_action', 'Unknown Player action');
    }
  } catch (error) {
    console.error('[treasure-player-action]', error);
    return fail(500, 'internal', 'Treasure Quiz action failed');
  }
}
