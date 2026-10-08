import type {
  BetType,
  ChestType,
  QuestionDefinition,
} from './treasure-types.ts';

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
  createRound?: (gameId: string, roundNo: number) => Promise<TqRound>;
  updateRound?: (roundId: string, patch: Record<string, unknown>) => Promise<TqRound>;
  placeBet?: (input: PlaceBetInput) => Promise<TqBet>;
  getQuestion?: (questionId: string) => Promise<TqQuestion | null>;
  getAnswer?: (gameId: string, roundNo: number, questionId?: string) => Promise<TqAnswer | null>;
  insertAnswer?: (input: InsertAnswerInput) => Promise<TqAnswer>;
  getCurrentQuestion?: (gameId: string, roundNo: number) => Promise<TqQuestion | null>;
  revealRound?: (gameId: string, roundNo: number) => Promise<TqRound>;
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

  return {
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
      const { data, error } = await client.from('tq_questions').upsert({
        id: question.id,
        round_no: question.roundNo,
        position: question.position,
        question_type: question.questionType,
        prompt: question.prompt,
        keyword: question.keyword,
        choices: question.choices,
        correct_answer: question.correctAnswer,
        difficulty: question.difficulty,
        active: true,
      }).select().single();
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
      const { data, error } = await client.from('tq_reward_catalog').insert(item).select().single();
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
    createRound: async (gameId, roundNo) => {
      const { data, error } = await client.from('tq_rounds').insert({ game_id: gameId, round_no: roundNo }).select().single();
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
    getCurrentQuestion: async (gameId, roundNo) => {
      const { data, error } = await client.from('tq_answers').select('question_id').eq('game_id', gameId).eq('round_no', roundNo).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
      if (error || !data) return null;
      const row = await single<any>(client.from('tq_questions').select('*').eq('id', data.question_id));
      return row ? { ...row, roundNo: row.round_no, position: row.position, questionType: row.question_type, correctAnswer: row.correct_answer } as TqQuestion : null;
    },
    revealRound: async (gameId, roundNo) => {
      const round = await single<TqRound>(client.from('tq_rounds').select('*').eq('game_id', gameId).eq('round_no', roundNo));
      if (!round) throw new Error('Round not found');
      return round;
    },
  };
}
