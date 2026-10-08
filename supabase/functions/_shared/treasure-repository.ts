import type {
  BetType,
  ChestType,
  QuestionDefinition,
} from './treasure-types.ts';
import { drawWeightedReward, isEventCheckpoint, settleRound } from './treasure-game.ts';

export interface TqProfile {
  id: string;
  auth_user_id?: string | null;
  display_name?: string;
  balance_satang?: number;
}

export interface TqGame {
  id: string;
  phase?: string;
  current_round?: number;
  player_profile_id?: string;
  gold?: number;
  gems?: number;
  config_snapshot?: unknown;
  [key: string]: unknown;
}

export interface TqRound {
  id: string;
  game_id?: string;
  round_no?: number;
  phase?: string;
  bet_type?: BetType | string;
  stake_gold?: number;
  stake_gems?: number;
  deadline?: string | null;
  correct_count?: number | null;
  answered_count?: number | null;
  base_reward_gold?: number | null;
  bonus_reward_gold?: number | null;
  achievement_gems?: number | null;
  [key: string]: unknown;
}

export interface TqQuestion extends Partial<QuestionDefinition> {
  id: string;
  correct_answer?: string;
  [key: string]: unknown;
}

export interface TqAnswer {
  id: string;
  question_id?: string;
  answer?: unknown;
  is_correct?: boolean;
  [key: string]: unknown;
}

export interface TqBet {
  id: string;
  game_id?: string;
  round_no?: number;
  bet_type?: BetType;
  stake_gold?: number;
  stake_gems?: number;
  [key: string]: unknown;
}

export interface TqChestOpen {
  id: string;
  chest_key?: string;
  status?: string;
  result_satang?: number | null;
  wallet_entry_id?: string | null;
  [key: string]: unknown;
}

export interface TqRedemption {
  id: string;
  player_profile_id?: string;
  reward_catalog_id?: string;
  cost_satang?: number;
  status?: 'pending' | 'completed' | 'cancelled' | string;
  [key: string]: unknown;
}

export interface CreateGameInput {
  playerProfileId: string;
  gold: number;
  gems: number;
  configSnapshot: unknown;
}

export interface LinkProfileInput {
  authUserId: string;
  displayName?: string;
  [key: string]: unknown;
}

export interface PlaceBetInput {
  gameId: string;
  roundNo: number;
  betType: BetType;
  stakeGold: number;
  stakeGems: number;
}

export interface InsertAnswerInput {
  gameId: string;
  roundNo: number;
  questionId: string;
  answer: unknown;
  isCorrect: boolean;
  responseMs?: number;
}

export interface TreasureRepository {
  authenticate?: (accessToken: string) => Promise<string | null>;
  getActiveGame?: () => Promise<TqGame | null>;
  getQuestionDefinitions?: () => Promise<any[]>;
  saveQuestion?: (question: QuestionDefinition & { id?: string }) => Promise<unknown>;
  saveChestType?: (chest: ChestType) => Promise<unknown>;
  saveRewardItem?: (item: Record<string, unknown>) => Promise<unknown>;
  createGame?: (input: CreateGameInput) => Promise<TqGame>;
  getGame?: (gameId: string) => Promise<TqGame | null>;
  updateGame?: (gameId: string, patch: Record<string, unknown>) => Promise<any>;
  getProfile?: (authUserId?: string) => Promise<TqProfile | null>;
  linkProfile?: (input: LinkProfileInput) => Promise<TqProfile>;
  joinGame?: (gameId: string, profileId: string) => Promise<TqGame>;
  getRound?: (gameId: string, roundNo: number) => Promise<TqRound | null>;
  createRound?: (gameId: string, roundNo: number, patch?: Record<string, unknown>) => Promise<TqRound>;
  updateRound?: (roundId: string, patch: Record<string, unknown>) => Promise<TqRound>;
  placeBet?: (input: PlaceBetInput) => Promise<TqBet>;
  getQuestion?: (questionId: string) => Promise<TqQuestion | null>;
  getAnswer?: (gameId: string, roundNo: number, questionId?: string) => Promise<TqAnswer | null>;
  insertAnswer?: (input: InsertAnswerInput) => Promise<TqAnswer>;
  getAnswers?: (gameId: string, roundNo: number) => Promise<TqAnswer[]>;
  getQuestionsForRound?: (roundNo: number) => Promise<TqQuestion[]>;
  getCurrentQuestion?: (gameId: string, roundNo: number) => Promise<TqQuestion | null>;
  revealRound?: (gameId: string, roundNo: number) => Promise<TqRound>;
  getChestTypes?: () => Promise<any[]>;
  submitChestCart?: (input: { gameId: string; profileId: string; cart: unknown[]; discountTarget?: string }) => Promise<TqChestOpen[]>;
  getChestOpen?: (id: string) => Promise<TqChestOpen | null>;
  openChest?: (id: string) => Promise<TqChestOpen>;
  openAllChests?: (gameId: string, profileId: string) => Promise<TqChestOpen[]>;
  getChestOpens?: (gameId: string, profileId: string) => Promise<TqChestOpen[]>;
  getWallet?: (profileId: string) => Promise<{ balanceSatang: number; entries: any[] }>;
  getRewardCatalog?: () => Promise<any[]>;
  requestRedemption?: (input: { profileId: string; rewardCatalogId: string }) => Promise<TqRedemption>;
  getRedemptions?: () => Promise<TqRedemption[]>;
  getRedemption?: (id: string) => Promise<TqRedemption | null>;
  completeRedemption?: (id: string) => Promise<TqRedemption>;
  cancelRedemption?: (id: string) => Promise<TqRedemption>;
  adjustWallet?: (input: { profileId: string; amountSatang: number; reason: string }) => Promise<TqRedemption | Record<string, unknown>>;
}

export interface HostDeps {
  hostPin: string;
  repository: TreasureRepository;
}

export interface PlayerDeps {
  playerPin: string;
  repository: TreasureRepository;
}

/** Small adapter used by the Edge Function entry points. Mutations that need
 * atomic balance/deadline checks can later be moved behind SQL RPCs without
 * changing either action handler or the browser contract. */
export function createTreasureRepository(client: any): TreasureRepository {
  const single = async <T>(query: any): Promise<T | null> => {
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return data as T | null;
  };

  const repository: TreasureRepository = {
    authenticate: async (accessToken) => {
      const { data, error } = await client.auth.getUser(accessToken);
      if (error || !data?.user) return null;
      return data.user.id;
    },
    getActiveGame: async () => {
      const { data, error } = await client
        .from('tq_games')
        .select('*')
        .not('phase', 'in', '(finished,cancelled)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as TqGame | null;
    },
    getQuestionDefinitions: async () => {
      const { data, error } = await client.from('tq_questions').select('*').eq('active', true).order('round_no').order('position');
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        ...row,
        choices: Array.isArray(row.choices) ? row.choices : [],
        correctAnswer: row.correct_answer,
        roundNo: row.round_no,
        questionType: row.question_type,
      }));
    },
    saveQuestion: async (question) => {
      const row: Record<string, unknown> = {
        round_no: question.roundNo,
        position: question.position,
        question_type: question.questionType,
        prompt: question.prompt,
        keyword: question.keyword,
        choices: question.choices,
        correct_answer: question.correctAnswer,
        difficulty: question.difficulty,
        active: true,
      };
      if (question.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(question.id)) row.id = question.id;
      const { data, error } = await client.from('tq_questions').upsert(row, { onConflict: 'round_no,position' }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    saveChestType: async (chest) => {
      const { data, error } = await client.from('tq_chest_types').upsert({
        key: chest.key, name: chest.name, gold_cost: chest.goldCost, gem_cost: chest.gemCost, reward_table: chest.rewardTable, enabled: true,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    saveRewardItem: async (item) => {
      const { data, error } = await client.from('tq_reward_catalog').insert({
        title: String(item.title ?? ''),
        reward_kind: String(item.rewardKind ?? item.reward_kind ?? 'cash'),
        cost_satang: Number(item.costSatang ?? item.cost_satang ?? 0),
        active: true,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    createGame: async (input) => {
      const { data, error } = await client.from('tq_games').insert({
        player_profile_id: input.playerProfileId,
        gold: input.gold,
        gems: input.gems,
        config_snapshot: input.configSnapshot,
        phase: 'waiting',
        current_round: 0,
      }).select().single();
      if (error) throw new Error(error.message);
      return data as TqGame;
    },
    getGame: async (gameId) => single<TqGame>(client.from('tq_games').select('*').eq('id', gameId)),
    updateGame: async (gameId, patch) => {
      const { data, error } = await client.from('tq_games').update(patch).eq('id', gameId).select().single();
      if (error) throw new Error(error.message);
      return data as TqGame;
    },
    getProfile: async (authUserId) => {
      const query = client.from('tq_player_profile').select('*');
      if (authUserId) query.eq('auth_user_id', authUserId);
      else query.eq('singleton', true);
      return single<TqProfile>(query);
    },
    linkProfile: async ({ authUserId, displayName }) => {
      const { data, error } = await client.from('tq_player_profile').update({ auth_user_id: authUserId, ...(displayName ? { display_name: displayName } : {}) }).eq('singleton', true).select().single();
      if (error) throw new Error(error.message);
      return data as TqProfile;
    },
    joinGame: async (gameId) => {
      const game = await single<TqGame>(client.from('tq_games').select('*').eq('id', gameId));
      if (!game) throw new Error('Game not found');
      return game;
    },
    getRound: async (gameId, roundNo) => single<TqRound>(client.from('tq_rounds').select('*').eq('game_id', gameId).eq('round_no', roundNo)),
    createRound: async (gameId, roundNo, patch = {}) => {
      const { data, error } = await client.from('tq_rounds').insert({ game_id: gameId, round_no: roundNo, ...patch }).select().single();
      if (error) throw new Error(error.message);
      return data as TqRound;
    },
    updateRound: async (roundId, patch) => {
      const { data, error } = await client.from('tq_rounds').update(patch).eq('id', roundId).select().single();
      if (error) throw new Error(error.message);
      return data as TqRound;
    },
    placeBet: async (input) => {
      const round = await single<TqRound>(client.from('tq_rounds').select('*').eq('game_id', input.gameId).eq('round_no', input.roundNo));
      if (round) {
        const { data, error } = await client.from('tq_rounds').update({ bet_type: input.betType, stake_gold: input.stakeGold, stake_gems: input.stakeGems }).eq('id', round.id).select().single();
        if (error) throw new Error(error.message);
        return { id: round.id, ...data } as TqBet;
      }
      const { data, error } = await client.from('tq_rounds').insert({ game_id: input.gameId, round_no: input.roundNo, bet_type: input.betType, stake_gold: input.stakeGold, stake_gems: input.stakeGems }).select().single();
      if (error) throw new Error(error.message);
      return { id: data.id, ...input, ...data } as TqBet;
    },
    getQuestion: async (questionId) => {
      const row = await single<any>(client.from('tq_questions').select('*').eq('id', questionId));
      return row ? {
        ...row,
        roundNo: row.round_no,
        position: row.position,
        questionType: row.question_type,
        correctAnswer: row.correct_answer,
      } as TqQuestion : null;
    },
    getAnswer: async (gameId, roundNo, questionId) => {
      const query = client.from('tq_answers').select('*').eq('game_id', gameId).eq('round_no', roundNo);
      if (questionId) query.eq('question_id', questionId);
      return single<TqAnswer>(query);
    },
    insertAnswer: async (input) => {
      const { data, error } = await client.from('tq_answers').insert({ game_id: input.gameId, round_no: input.roundNo, question_id: input.questionId, answer: input.answer, is_correct: input.isCorrect, response_ms: input.responseMs }).select().single();
      if (error) throw new Error(error.message);
      return data as TqAnswer;
    },
    getAnswers: async (gameId, roundNo) => {
      const { data, error } = await client.from('tq_answers').select('*').eq('game_id', gameId).eq('round_no', roundNo).order('submitted_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as TqAnswer[];
    },
    getQuestionsForRound: async (roundNo) => {
      const { data, error } = await client.from('tq_questions').select('*').eq('active', true).eq('round_no', roundNo).order('position');
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        ...row,
        roundNo: row.round_no,
        position: row.position,
        questionType: row.question_type,
        correctAnswer: row.correct_answer,
        choices: Array.isArray(row.choices) ? row.choices : [],
      })) as TqQuestion[];
    },
    getCurrentQuestion: async (gameId, roundNo) => {
      const { data, error } = await client.from('tq_answers').select('question_id').eq('game_id', gameId).eq('round_no', roundNo).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      const row = data
        ? await single<any>(client.from('tq_questions').select('*').eq('id', data.question_id))
        : (await repository.getQuestionsForRound!(roundNo))[0];
      return row ? { ...row, roundNo: row.round_no, position: row.position, questionType: row.question_type, correctAnswer: row.correct_answer } as TqQuestion : null;
    },
    revealRound: async (gameId, roundNo) => {
      const round = await single<TqRound>(client.from('tq_rounds').select('*').eq('game_id', gameId).eq('round_no', roundNo));
      if (!round) throw new Error('Round not found');
      if (round.correct_count !== null && round.correct_count !== undefined) return round;
      const game = await single<TqGame>(client.from('tq_games').select('*').eq('id', gameId));
      if (!game) throw new Error('Game not found');
      const answers = await repository.getAnswers!(gameId, roundNo);
      const questions = await repository.getQuestionsForRound!(roundNo);
      const correctCount = answers.filter((answer) => answer.is_correct).length;
      const answeredCount = answers.length;
      const secondsRemaining = round.deadline ? Math.max(0, Math.floor((Date.parse(String(round.deadline)) - Date.now()) / 1000)) : null;
      const eventEffects = Array.isArray(round.active_effects)
        ? round.active_effects.map((effect) => typeof effect === 'object' && effect && 'code' in effect ? String((effect as { code?: unknown }).code) : '').filter(Boolean)
        : [];
      const settlement = settleRound({
        roundNo,
        questionCount: questions.length,
        correctCount,
        secondsRemaining,
        betType: (round.bet_type ?? 'safe') as any,
        eventEffects,
        noMistakeFailed: roundNo >= 7 && answers.some((answer) => answer.is_correct === false),
      });
      const updatedRound = await repository.updateRound!(round.id, {
        phase: 'round_result',
        correct_count: correctCount,
        answered_count: answeredCount,
        base_reward_gold: settlement.baseGold,
        bonus_reward_gold: settlement.roundBonusGold + settlement.eventBonusGold + settlement.betBonusGold + settlement.stakeGoldRefund,
        achievement_gems: settlement.gemsEarned + settlement.stakeGemRefund,
      });
      await repository.updateGame!(gameId, {
        gold: (game.gold ?? 0) + settlement.goldCredit,
        gems: (game.gems ?? 0) + settlement.gemsEarned + settlement.stakeGemRefund,
        phase: roundNo === 8 ? 'prize_shop' : isEventCheckpoint(roundNo) ? 'event' : 'round_result',
      });
      return updatedRound;
    },
    getChestTypes: async () => {
      const { data, error } = await client.from('tq_chest_types').select('*').eq('enabled', true).order('gold_cost');
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({ key: row.key, name: row.name, goldCost: row.gold_cost, gemCost: row.gem_cost, rewardTable: row.reward_table }));
    },
    submitChestCart: async ({ gameId, profileId, cart, discountTarget }) => {
      const game = await single<any>(client.from('tq_games').select('gold,gems').eq('id', gameId));
      const chestTypes = await (async () => {
        const { data, error } = await client.from('tq_chest_types').select('*').eq('enabled', true);
        if (error) throw new Error(error.message);
        return data ?? [];
      })();
      const byKey = new Map<string, any>(chestTypes.map((row: any) => [row.key, row] as [string, any]));
      let gold = 0;
      let gems = 0;
      const rows: any[] = [];
      let closeoutRequested = false;
      for (const item of cart as any[]) {
        if (item.key === 'closeout') {
          closeoutRequested = true;
          continue;
        }
        const chest = byKey.get(item.key);
        if (!chest) continue;
        gold += chest.gold_cost * item.quantity;
        gems += chest.gem_cost * item.quantity;
        for (let index = 0; index < item.quantity; index += 1) rows.push({ game_id: gameId, player_profile_id: profileId, chest_key: item.key, gold_cost: chest.gold_cost, gem_cost: chest.gem_cost, purchase_index: rows.length + 1, idempotency_key: `${gameId}:${rows.length + 1}` });
      }
      if (discountTarget) gold = Math.max(0, gold - 100);
      if (closeoutRequested) {
        const remainder = (game?.gold ?? 0) - gold;
        if (remainder >= 1 && remainder <= 99) {
          const consolation = byKey.get('consolation');
          if (consolation) rows.push({ game_id: gameId, player_profile_id: profileId, chest_key: 'consolation', gold_cost: remainder, gem_cost: 0, purchase_index: rows.length + 1, idempotency_key: `${gameId}:${rows.length + 1}` });
          gold += remainder;
        }
      }
      const { data: inserted, error } = await client.from('tq_chest_opens').insert(rows).select('*');
      if (error) throw new Error(error.message);
      const { error: gameError } = await client.from('tq_games').update({ gold: Math.max(0, (game?.gold ?? 0) - gold), gems: Math.max(0, (game?.gems ?? 0) - gems), phase: 'chest_opening' }).eq('id', gameId);
      if (gameError) throw new Error(gameError.message);
      return (inserted ?? []) as TqChestOpen[];
    },
    getChestOpen: async (id) => single<TqChestOpen>(client.from('tq_chest_opens').select('*').eq('id', id)),
    openChest: async (id) => {
      const open = await single<any>(client.from('tq_chest_opens').select('*').eq('id', id));
      if (!open) throw new Error('Chest purchase not found');
      if (open.status === 'opened') return open as TqChestOpen;
      const chest = await single<any>(client.from('tq_chest_types').select('reward_table').eq('key', open.chest_key));
      if (!chest) throw new Error('Chest type not found');
      const table = (chest.reward_table ?? []).map((reward: any) => ({ amountSatang: reward.amount_satang, weight: reward.weight }));
      const resultSatang = drawWeightedReward(table, Math.random());
      const { data: walletEntry, error: walletError } = await client.from('tq_wallet_entries').insert({ player_profile_id: open.player_profile_id, amount_satang: resultSatang, entry_type: 'chest_reward', reference_id: open.id, idempotency_key: `chest:${open.id}` }).select().single();
      if (walletError) throw new Error(walletError.message);
      const profile = await single<any>(client.from('tq_player_profile').select('balance_satang').eq('id', open.player_profile_id));
      const { error: profileError } = await client.from('tq_player_profile').update({ balance_satang: (profile?.balance_satang ?? 0) + resultSatang }).eq('id', open.player_profile_id);
      if (profileError) throw new Error(profileError.message);
      const { data: updated, error } = await client.from('tq_chest_opens').update({ status: 'opened', result_satang: resultSatang, opened_at: new Date().toISOString(), wallet_entry_id: walletEntry.id }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return updated as TqChestOpen;
    },
    openAllChests: async (gameId, profileId) => {
      const { data, error } = await client.from('tq_chest_opens').select('id,status').eq('game_id', gameId).eq('player_profile_id', profileId).order('purchase_index');
      if (error) throw new Error(error.message);
      const result: TqChestOpen[] = [];
      for (const row of data ?? []) result.push(await (row.status === 'opened' ? single<TqChestOpen>(client.from('tq_chest_opens').select('*').eq('id', row.id)) : repository.openChest!(row.id)) as TqChestOpen);
      await client.from('tq_games').update({ phase: 'finished' }).eq('id', gameId);
      return result;
    },
    getChestOpens: async (gameId, profileId) => {
      const { data, error } = await client.from('tq_chest_opens').select('*').eq('game_id', gameId).eq('player_profile_id', profileId).order('purchase_index');
      if (error) throw new Error(error.message);
      return (data ?? []) as TqChestOpen[];
    },
    getWallet: async (profileId) => {
      const profile = await single<any>(client.from('tq_player_profile').select('balance_satang').eq('id', profileId));
      const { data, error } = await client.from('tq_wallet_entries').select('*').eq('player_profile_id', profileId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { balanceSatang: profile?.balance_satang ?? 0, entries: data ?? [] };
    },
    getRewardCatalog: async () => {
      const { data, error } = await client.from('tq_reward_catalog').select('id,title,reward_kind,cost_satang').eq('active', true).order('cost_satang');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    requestRedemption: async ({ profileId, rewardCatalogId }) => {
      const reward = await single<any>(client.from('tq_reward_catalog').select('id,cost_satang').eq('id', rewardCatalogId).eq('active', true));
      if (!reward) throw new Error('Reward catalog item not found');
      const { data, error } = await client.from('tq_redemptions').insert({ player_profile_id: profileId, reward_catalog_id: rewardCatalogId, cost_satang: reward.cost_satang, status: 'pending' }).select().single();
      if (error) throw new Error(error.message);
      return data as TqRedemption;
    },
    getRedemptions: async () => {
      const { data, error } = await client.from('tq_redemptions').select('*, tq_reward_catalog(title)').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({ ...row, title: row.tq_reward_catalog?.title ?? null })) as TqRedemption[];
    },
    getRedemption: async (id) => single<TqRedemption>(client.from('tq_redemptions').select('*').eq('id', id)),
    completeRedemption: async (id) => {
      const redemption = await single<any>(client.from('tq_redemptions').select('*').eq('id', id));
      if (!redemption) throw new Error('Redemption not found');
      if (redemption.status === 'completed') return redemption as TqRedemption;
      if (redemption.status !== 'pending') throw new Error('Redemption cannot be completed');
      const profile = await single<any>(client.from('tq_player_profile').select('balance_satang').eq('id', redemption.player_profile_id));
      if ((profile?.balance_satang ?? 0) < redemption.cost_satang) throw new Error('Insufficient wallet balance');
      const { error: walletError } = await client.from('tq_wallet_entries').insert({ player_profile_id: redemption.player_profile_id, amount_satang: -redemption.cost_satang, entry_type: 'redemption', reference_id: redemption.id, idempotency_key: `redemption:${redemption.id}` });
      if (walletError) throw new Error(walletError.message);
      const { error: profileError } = await client.from('tq_player_profile').update({ balance_satang: profile.balance_satang - redemption.cost_satang }).eq('id', redemption.player_profile_id);
      if (profileError) throw new Error(profileError.message);
      const { data, error } = await client.from('tq_redemptions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending').select().single();
      if (error) throw new Error(error.message);
      return data as TqRedemption;
    },
    cancelRedemption: async (id) => {
      const redemption = await single<any>(client.from('tq_redemptions').select('*').eq('id', id));
      if (!redemption) throw new Error('Redemption not found');
      if (redemption.status === 'cancelled') return redemption as TqRedemption;
      if (redemption.status !== 'pending') throw new Error('Redemption cannot be cancelled');
      const { data, error } = await client.from('tq_redemptions').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending').select().single();
      if (error) throw new Error(error.message);
      return data as TqRedemption;
    },
    adjustWallet: async ({ profileId, amountSatang, reason }) => {
      const profile = await single<any>(client.from('tq_player_profile').select('balance_satang').eq('id', profileId));
      if (!profile) throw new Error('Profile not found');
      const nextBalance = profile.balance_satang + amountSatang;
      if (nextBalance < 0) throw new Error('Insufficient wallet balance');
      const { data: entry, error: entryError } = await client.from('tq_wallet_entries').insert({ player_profile_id: profileId, amount_satang: amountSatang, entry_type: 'host_adjustment', reason, idempotency_key: `adjustment:${crypto.randomUUID()}` }).select().single();
      if (entryError) throw new Error(entryError.message);
      const { error } = await client.from('tq_player_profile').update({ balance_satang: nextBalance }).eq('id', profileId);
      if (error) throw new Error(error.message);
      return { balanceSatang: nextBalance, entry };
    },
  };
  return repository;
}
