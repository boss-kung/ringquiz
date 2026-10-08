import type {
  ChestCartInput,
  ChestCartQuote,
  ChestType,
  EventInput,
  EventResult,
  QuestionDefinition,
  RoundSettlement,
  RoundSettlementInput,
  ValidationResult,
  WeightedReward,
} from './treasure-types.ts';

export type EventChoice = 'skip' | 'gold' | 'diamond';
export interface ActiveEffect { code: string; durationRounds: number; }
export const EVENT_CODES = [
  'reward_boost_20', 'extra_keyword', 'bet_shield', 'mistake_shield',
  'chest_discount_100', 'extra_time_5', 'tax_50', 'boss_question',
] as const;

export const DEFAULT_CHEST_TYPES: ChestType[] = [
  {
    key: 'copper',
    name: 'หีบทองแดง',
    goldCost: 100,
    gemCost: 0,
    rewardTable: [
      { amountSatang: 1, weight: 60 },
      { amountSatang: 10, weight: 30 },
      { amountSatang: 50, weight: 10 },
    ],
  },
  {
    key: 'silver',
    name: 'หีบเงิน',
    goldCost: 300,
    gemCost: 0,
    rewardTable: [
      { amountSatang: 50, weight: 55 },
      { amountSatang: 100, weight: 35 },
      { amountSatang: 200, weight: 10 },
    ],
  },
  {
    key: 'gold',
    name: 'หีบทอง',
    goldCost: 700,
    gemCost: 1,
    rewardTable: [
      { amountSatang: 100, weight: 50 },
      { amountSatang: 200, weight: 30 },
      { amountSatang: 500, weight: 18 },
      { amountSatang: 1000, weight: 2 },
    ],
  },
  {
    key: 'diamond',
    name: 'หีบเพชร',
    goldCost: 1500,
    gemCost: 3,
    rewardTable: [
      { amountSatang: 500, weight: 50 },
      { amountSatang: 1000, weight: 30 },
      { amountSatang: 2000, weight: 17 },
      { amountSatang: 5000, weight: 2 },
      { amountSatang: 10000, weight: 1 },
    ],
  },
  {
    key: 'crystal',
    name: 'หีบคริสตัล',
    goldCost: 0,
    gemCost: 1,
    rewardTable: [
      { amountSatang: 10, weight: 60 },
      { amountSatang: 50, weight: 30 },
      { amountSatang: 100, weight: 10 },
    ],
  },
  {
    key: 'consolation',
    name: 'หีบปลอบใจ',
    goldCost: 0,
    gemCost: 0,
    rewardTable: [{ amountSatang: 1, weight: 100 }],
  },
];

const BASE_GOLD_BY_ROUND: Record<number, number> = {
  1: 15,
  2: 15,
  3: 40,
  4: 50,
  5: 50,
  6: 60,
  7: 60,
  8: 80,
};

function roundPerfectBonus(input: RoundSettlementInput): number {
  const perfect = input.correctCount === input.questionCount && !input.noMistakeFailed;
  if (!perfect) return 0;
  switch (input.roundNo) {
    case 1:
    case 2:
    case 3:
    case 4:
      return 50;
    case 7:
      return 250;
    case 8:
      return 400;
    default:
      return 0;
  }
}

function timeBonus(input: RoundSettlementInput): number {
  if (input.secondsRemaining === null || input.secondsRemaining <= 0) return 0;
  if (input.roundNo === 5 && input.correctCount >= 4) return Math.floor(input.secondsRemaining * 5);
  if (input.roundNo === 6 && input.correctCount === input.questionCount) {
    return Math.floor(input.secondsRemaining * 10);
  }
  return 0;
}

function betTarget(roundNo: number): number {
  if (roundNo <= 2) return 8;
  if (roundNo <= 6) return 4;
  return 5;
}

export function settleRound(input: RoundSettlementInput): RoundSettlement {
  const perQuestion = BASE_GOLD_BY_ROUND[input.roundNo] ?? 0;
  const safeCorrect = Math.max(0, Math.min(input.correctCount, input.questionCount));
  const baseGold = safeCorrect * perQuestion;
  const roundBonusGold = roundPerfectBonus({ ...input, correctCount: safeCorrect }) + timeBonus({ ...input, correctCount: safeCorrect });
  const eventBonusGold = input.eventEffects.includes('reward_boost_20')
    ? Math.floor((baseGold + roundBonusGold) * 0.2)
    : 0;
  const passedBet = input.betType === 'safe'
    ? true
    : input.roundNo >= 7
      ? safeCorrect === betTarget(input.roundNo) && !input.noMistakeFailed
      : safeCorrect >= betTarget(input.roundNo);
  const betBonusGold = passedBet && input.betType !== 'safe'
    ? input.betType === 'gold'
      ? Math.floor(baseGold * 0.5)
      : baseGold
    : 0;
  const stakeGoldRefund = passedBet && input.betType === 'gold' ? 100 : 0;
  const stakeGemRefund = passedBet && input.betType === 'diamond' ? 1 : 0;
  const gemsEarned = input.noMistakeFailed
    ? 0
    : input.roundNo === 7 && safeCorrect === input.questionCount
      ? 1
      : input.roundNo === 8 && safeCorrect === input.questionCount
        ? 2
        : 0;

  return {
    baseGold,
    roundBonusGold,
    eventBonusGold,
    betBonusGold,
    stakeGoldRefund,
    stakeGemRefund,
    goldCredit: baseGold + roundBonusGold + eventBonusGold + betBonusGold + stakeGoldRefund,
    gemsEarned,
    passedBet,
  };
}

export function applyEvent(input: EventInput): EventResult {
  const durationRounds = input.code === 'reward_boost_20' ? 2 : input.code === 'skip' ? 0 : 1;
  return { code: input.code, durationRounds };
}

export function isEventCheckpoint(roundNo: number): boolean {
  return roundNo === 2 || roundNo === 4 || roundNo === 6;
}

export function eventCost(choice: EventChoice): { gold: number; gems: number } {
  if (choice === 'gold') return { gold: 150, gems: 0 };
  if (choice === 'diamond') return { gold: 0, gems: 1 };
  return { gold: 0, gems: 0 };
}

export function normalizeActiveEffect(value: unknown): ActiveEffect | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { code?: unknown; durationRounds?: unknown };
  if (typeof candidate.code !== 'string' || !EVENT_CODES.includes(candidate.code as typeof EVENT_CODES[number])) return null;
  const durationRounds = Number(candidate.durationRounds);
  if (!Number.isInteger(durationRounds) || durationRounds < 1) return null;
  return { code: candidate.code, durationRounds };
}

export function drawEventForChoice(choice: EventChoice, randomUnit = Math.random()): EventResult {
  if (choice === 'skip') return applyEvent({ code: 'skip' });
  const index = Math.min(EVENT_CODES.length - 1, Math.floor(Math.max(0, Math.min(0.999999, randomUnit)) * EVENT_CODES.length));
  return applyEvent({ code: EVENT_CODES[index] });
}

export function drawWeightedReward(table: WeightedReward[], randomUnit: number): number {
  if (table.length === 0) throw new Error('Reward table cannot be empty');
  if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1) {
    throw new Error('randomUnit must be in [0, 1)');
  }
  const totalWeight = table.reduce((sum, reward) => sum + reward.weight, 0);
  if (totalWeight <= 0 || table.some((reward) => reward.weight <= 0)) {
    throw new Error('Reward weights must be positive');
  }
  let cumulative = 0;
  for (const reward of table) {
    cumulative += reward.weight / totalWeight;
    if (randomUnit < cumulative) return reward.amountSatang;
  }
  return table[table.length - 1].amountSatang;
}

export function validateQuestionSet(questions: QuestionDefinition[]): ValidationResult {
  const errors: string[] = [];
  if (questions.length !== 50) errors.push(`Question set must contain exactly 50 questions (received ${questions.length})`);
  const requiredPerRound = new Map<number, number>([
    [1, 10], [2, 10], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5],
  ]);
  const counts = new Map<number, number>();
  for (const [index, question] of questions.entries()) {
    counts.set(question.roundNo, (counts.get(question.roundNo) ?? 0) + 1);
    if (!question.prompt.trim()) errors.push(`Question ${index + 1} is missing a prompt`);
    if (!question.keyword.trim()) errors.push(`Question ${index + 1} is missing a keyword`);
    if (new Set(question.choices).size !== question.choices.length) errors.push(`Question ${index + 1} has duplicate choices`);
    if (!question.choices.includes(question.correctAnswer)) errors.push(`Question ${index + 1} is missing the correct answer in choices`);
    if (question.roundNo < 1 || question.roundNo > 8) errors.push(`Question ${index + 1} has an invalid round number`);
  }
  for (const [roundNo, required] of requiredPerRound) {
    if ((counts.get(roundNo) ?? 0) !== required) errors.push(`Round ${roundNo} must contain ${required} questions`);
  }
  return { ok: errors.length === 0, errors };
}

export function quoteChestCart(input: ChestCartInput): ChestCartQuote {
  const errors: string[] = [];
  const types = input.chestTypes ?? DEFAULT_CHEST_TYPES;
  const byKey = new Map(types.map((chest) => [chest.key, chest]));
  let totalGold = 0;
  let totalGems = 0;
  let discountApplied = false;
  let closeoutRequested = false;

  if (!Number.isInteger(input.gold) || input.gold < 0) errors.push('Gold balance must be a non-negative integer');
  if (!Number.isInteger(input.gems) || input.gems < 0) errors.push('Gem balance must be a non-negative integer');
  if (input.cart.length === 0) errors.push('Cart cannot be empty');

  for (const item of input.cart) {
    if (item.key === 'closeout') {
      if (item.quantity !== 1) errors.push('Closeout must be exactly one chest');
      closeoutRequested = true;
      continue;
    }
    const chest = byKey.get(item.key);
    if (!chest) {
      errors.push(`Unknown chest: ${item.key}`);
      continue;
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.push(`Quantity for ${item.key} must be positive`);
      continue;
    }
    totalGold += chest.goldCost * item.quantity;
    totalGems += chest.gemCost * item.quantity;
    if (item.key === input.discountTarget) discountApplied = true;
  }

  if (input.discountTarget && !discountApplied) errors.push('Discount target must be included in the cart');
  if (input.discountTarget === 'copper' || input.discountTarget === 'crystal') errors.push('Copper and Crystal cannot receive a discount');
  if (input.discountTarget === 'closeout' || input.discountTarget === 'consolation') errors.push('Closeout and Consolation cannot receive a discount');
  if (discountApplied) totalGold = Math.max(0, totalGold - 100);

  let rawRemainingGold = input.gold - totalGold;
  if (closeoutRequested) {
    if (rawRemainingGold >= 1 && rawRemainingGold <= 99) {
      totalGold += rawRemainingGold;
      rawRemainingGold = 0;
    } else {
      errors.push('Closeout requires 1–99 remaining gold');
    }
  }
  const remainingGold = rawRemainingGold >= 0 && rawRemainingGold < 100 ? 0 : rawRemainingGold;
  const remainingGems = input.gems - totalGems;
  if (rawRemainingGold < 0) errors.push('Not enough gold');
  if (remainingGems < 0) errors.push('Not enough gems');
  if (rawRemainingGold >= 100) errors.push('Spend all gold before ending the chest opening');
  return {
    ok: errors.length === 0 && remainingGold === 0 && remainingGems === 0,
    totalGold,
    totalGems,
    remainingGold: Math.max(0, remainingGold),
    remainingGems: Math.max(0, remainingGems),
    errors,
  };
}
