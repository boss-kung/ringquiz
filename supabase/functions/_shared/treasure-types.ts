export type QuestionType = 'true_false' | 'multiple_choice' | 'time_bank' | 'no_mistake';
export type BetType = 'safe' | 'gold' | 'diamond';

export interface QuestionDefinition {
  roundNo: number;
  position: number;
  questionType: QuestionType;
  prompt: string;
  keyword: string;
  choices: string[];
  correctAnswer: string;
  difficulty: number;
}

export interface WeightedReward {
  amountSatang: number;
  weight: number;
}

export interface ChestType {
  key: string;
  name: string;
  goldCost: number;
  gemCost: number;
  rewardTable: WeightedReward[];
}

export interface RoundSettlementInput {
  roundNo: number;
  questionCount: number;
  correctCount: number;
  secondsRemaining: number | null;
  betType: BetType;
  eventEffects: string[];
  noMistakeFailed?: boolean;
}

export interface RoundSettlement {
  baseGold: number;
  roundBonusGold: number;
  eventBonusGold: number;
  betBonusGold: number;
  stakeGoldRefund: number;
  stakeGemRefund: number;
  goldCredit: number;
  gemsEarned: number;
  passedBet: boolean;
}

export interface EventInput {
  code: string;
}

export interface EventResult {
  code: string;
  durationRounds?: number;
}

export interface ChestCartItem {
  key: string;
  quantity: number;
}

export interface ChestCartInput {
  gold: number;
  gems: number;
  cart: ChestCartItem[];
  discountTarget?: string;
  chestTypes?: ChestType[];
}

export interface ChestCartQuote {
  ok: boolean;
  totalGold: number;
  totalGems: number;
  remainingGold: number;
  remainingGems: number;
  errors: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
