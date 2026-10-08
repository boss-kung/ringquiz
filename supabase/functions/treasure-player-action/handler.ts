import { corsHeaders } from '../_shared/cors.ts';
import { DEFAULT_CHEST_TYPES, drawEventForChoice, eventCost, isEventCheckpoint, quoteChestCart, type EventChoice } from '../_shared/treasure-game.ts';
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
      case 'buy_event': {
        if (!repo.getGame || !repo.updateGame) return fail(500, 'repository_method_missing', 'Event repository is not configured');
        const game = await repo.getGame(String(payload.gameId ?? ''));
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        const roundNo = Number(game.current_round ?? 0);
        if (!isEventCheckpoint(roundNo)) return fail(409, 'not_event_checkpoint', 'Events are available after rounds 2, 4 and 6');
        const round = repo.getRound ? await repo.getRound(game.id, roundNo) : null;
        if (round && (round as Record<string, unknown>).event_choice) return reply({ ok: true, already_submitted: true, event: (round as Record<string, unknown>).event_result });
        const choice = String(payload.choice ?? 'skip') as EventChoice;
        if (!['skip', 'gold', 'diamond'].includes(choice)) return fail(400, 'invalid_event_choice', 'Unknown event choice');
        const cost = eventCost(choice);
        if ((game.gold ?? 0) < cost.gold) return fail(409, 'insufficient_gold', 'Not enough gold for this event');
        if ((game.gems ?? 0) < cost.gems) return fail(409, 'insufficient_gems', 'Not enough gems for this event');
        const event = drawEventForChoice(choice);
        if (repo.updateRound && round) await repo.updateRound(round.id, { event_choice: choice, event_result: event, active_effects: event.durationRounds ? [event] : [] });
        const updatedGame = await repo.updateGame(game.id, { gold: (game.gold ?? 0) - cost.gold, gems: (game.gems ?? 0) - cost.gems });
        return reply({ ok: true, already_submitted: false, event, game: updatedGame });
      }
      case 'submit_chest_cart': {
        if (!repo.getGame) return fail(500, 'repository_method_missing', 'Chest repository is not configured');
        const game = await repo.getGame(String(payload.gameId ?? ''));
        if (!game) return fail(404, 'game_not_found', 'Game not found');
        const cart = Array.isArray(payload.cart) ? payload.cart : [];
        if (cart.length === 0 && (game.gold ?? 0) === 0 && (game.gems ?? 0) === 0) cart.push({ key: 'consolation', quantity: 1 });
        const chestTypes = repo.getChestTypes ? await repo.getChestTypes() : DEFAULT_CHEST_TYPES;
        const quote = quoteChestCart({ gold: game.gold ?? 0, gems: game.gems ?? 0, cart: cart as any, discountTarget: payload.discountTarget ? String(payload.discountTarget) : undefined, chestTypes: chestTypes as any });
        if (!quote.ok) {
          const suggestion = quote.remainingGold >= 100 ? { key: 'copper', quantity: Math.floor(quote.remainingGold / 100) } : quote.remainingGold > 0 ? { key: 'closeout', quantity: 1 } : quote.remainingGems > 0 ? { key: 'crystal', quantity: quote.remainingGems } : null;
          return fail(409, 'incomplete_chest_cart', JSON.stringify({ message: quote.errors.join('; ') || 'Spend all resources before confirming', suggestion }));
        }
        if (!repo.submitChestCart) return fail(500, 'repository_method_missing', 'Chest repository is not configured');
        const profileId = profile.id;
        const opens = await repo.submitChestCart({ gameId: game.id, profileId, cart, discountTarget: payload.discountTarget ? String(payload.discountTarget) : undefined });
        return reply({ ok: true, opens, quote });
      }
      case 'open_chest': {
        if (!repo.getChestOpen || !repo.openChest) return fail(500, 'repository_method_missing', 'Chest opening repository is not configured');
        const chestOpenId = String(payload.chestOpenId ?? '');
        const existing = await repo.getChestOpen(chestOpenId);
        if (existing?.status === 'opened') return reply({ ok: true, already_opened: true, chest: existing });
        const chest = await repo.openChest(chestOpenId);
        return reply({ ok: true, already_opened: false, chest });
      }
      case 'open_all_chests': {
        if (!repo.openAllChests) return fail(500, 'repository_method_missing', 'Chest opening repository is not configured');
        const opens = await repo.openAllChests(String(payload.gameId ?? ''), profile.id);
        return reply({ ok: true, opens });
      }
      case 'get_wallet': {
        if (!repo.getWallet) return fail(500, 'repository_method_missing', 'Wallet repository is not configured');
        return reply({ ok: true, wallet: await repo.getWallet(profile.id) });
      }
      case 'get_reward_catalog': {
        if (!repo.getRewardCatalog) return fail(500, 'repository_method_missing', 'Reward catalog repository is not configured');
        return reply({ ok: true, rewards: await repo.getRewardCatalog() });
      }
      case 'request_redemption': {
        if (!repo.requestRedemption) return fail(500, 'repository_method_missing', 'Redemption repository is not configured');
        const rewardCatalogId = String(payload.rewardCatalogId ?? '');
        if (!rewardCatalogId) return fail(400, 'reward_catalog_id_required', 'Reward catalog item is required');
        const redemption = await repo.requestRedemption({ profileId: profile.id, rewardCatalogId });
        return reply({ ok: true, redemption });
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
        const roundNo = Number(game.current_round ?? 0) || 1;
        const round = repo.getRound ? await repo.getRound(game.id, roundNo) : null;
        const question = repo.getCurrentQuestion
          ? await repo.getCurrentQuestion(game.id, roundNo)
          : repo.getQuestion ? await repo.getQuestion(String(game.current_question_id ?? payload.questionId ?? 'current-question')) : null;
        const questions = repo.getQuestionsForRound ? await repo.getQuestionsForRound(roundNo) : question ? [question] : [];
        const opens = repo.getChestOpens ? await repo.getChestOpens(game.id, profile.id) : [];
        const wallet = repo.getWallet ? await repo.getWallet(profile.id) : null;
        const rewards = repo.getRewardCatalog ? await repo.getRewardCatalog() : [];
        const chests = repo.getChestTypes ? await repo.getChestTypes() : [];
        return reply({
          ok: true,
          game,
          round: sanitizeRound(round),
          question: sanitizeQuestion(question),
          questions: questions.map((item) => sanitizeQuestion(item)),
          opens,
          wallet,
          rewards,
          chests,
        });
      }
      default:
        return fail(400, 'unknown_action', 'Unknown Player action');
    }
  } catch (error) {
    console.error('[treasure-player-action]', error);
    return fail(500, 'internal', 'Treasure Quiz action failed');
  }
}
