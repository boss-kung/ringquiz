import assert from 'node:assert/strict';
import {
  DEFAULT_CHEST_TYPES,
  applyEvent,
  drawWeightedReward,
  quoteChestCart,
  settleRound,
  validateQuestionSet,
} from './treasure-game.ts';
import type { QuestionDefinition, WeightedReward } from './treasure-types.ts';

const validQuestions: QuestionDefinition[] = Array.from({ length: 50 }, (_, index) => ({
  roundNo: index < 10 ? 1 : index < 20 ? 2 : Math.floor((index - 20) / 5) + 3,
  position: index < 20 ? (index % 10) + 1 : (index % 5) + 1,
  questionType: index < 20 ? 'true_false' : index < 40 ? 'multiple_choice' : index < 45 ? 'time_bank' : 'no_mistake',
  prompt: `Question ${index + 1}`,
  keyword: `Keyword ${index + 1}`,
  choices: index < 20 ? ['ใช่', 'ไม่ใช่'] : ['A', 'B', 'C', 'D'],
  correctAnswer: index < 20 ? 'ใช่' : 'A',
  difficulty: 1,
}));

const safe = {
  betType: 'safe' as const,
  secondsRemaining: null,
  eventEffects: [],
};

Deno.test('round 1 safe perfect answer returns 200 gold', () => {
  assert.deepEqual(
    settleRound({ roundNo: 1, questionCount: 10, correctCount: 10, ...safe }),
    {
      baseGold: 150,
      roundBonusGold: 50,
      eventBonusGold: 0,
      betBonusGold: 0,
      stakeGoldRefund: 0,
      stakeGemRefund: 0,
      goldCredit: 200,
      gemsEarned: 0,
      passedBet: true,
    },
  );
});

Deno.test('round 5 time bank awards remaining-time bonus after four correct answers', () => {
  assert.equal(
    settleRound({
      roundNo: 5,
      questionCount: 5,
      correctCount: 4,
      secondsRemaining: 8,
      betType: 'safe',
      eventEffects: [],
    }).goldCredit,
    240,
  );
});

Deno.test('round 7 wrong after two correct answers keeps base gold and drops perfect bonus', () => {
  const result = settleRound({
    roundNo: 7,
    questionCount: 5,
    correctCount: 2,
    secondsRemaining: 30,
    betType: 'safe',
    eventEffects: [],
    noMistakeFailed: true,
  });

  assert.equal(result.goldCredit, 120);
  assert.equal(result.gemsEarned, 0);
  assert.equal(result.roundBonusGold, 0);
});

Deno.test('gold bet success includes the 50 percent bonus and stake refund', () => {
  const result = settleRound({
    roundNo: 3,
    questionCount: 5,
    correctCount: 4,
    secondsRemaining: null,
    betType: 'gold',
    eventEffects: [],
  });

  assert.equal(result.baseGold, 160);
  assert.equal(result.betBonusGold, 80);
  assert.equal(result.stakeGoldRefund, 100);
  assert.equal(result.goldCredit, 340);
  assert.equal(result.passedBet, true);
});

Deno.test('diamond bet failure does not refund the diamond stake', () => {
  const result = settleRound({
    roundNo: 3,
    questionCount: 5,
    correctCount: 2,
    secondsRemaining: null,
    betType: 'diamond',
    eventEffects: [],
  });

  assert.equal(result.stakeGemRefund, 0);
  assert.equal(result.passedBet, false);
});

Deno.test('question validation rejects fewer than 50 questions', () => {
  const result = validateQuestionSet(validQuestions.slice(0, 49));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('50')));
});

Deno.test('question validation rejects duplicate choices and missing correct choice', () => {
  const questions = validQuestions.map((question) => ({ ...question, choices: [...question.choices] }));
  questions[0] = { ...questions[0], choices: ['ใช่', 'ใช่'] };
  questions[1] = { ...questions[1], correctAnswer: 'missing' };

  const result = validateQuestionSet(questions);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate')));
  assert.ok(result.errors.some((error) => error.includes('correct answer')));
});

Deno.test('weighted reward boundaries are deterministic', () => {
  const table: WeightedReward[] = [
    { amountSatang: 1, weight: 60 },
    { amountSatang: 10, weight: 30 },
    { amountSatang: 50, weight: 10 },
  ];

  assert.equal(drawWeightedReward(table, 0), 1);
  assert.equal(drawWeightedReward(table, 0.6), 10);
  assert.equal(drawWeightedReward(table, 0.999999), 50);
});

Deno.test('default chest tables have weights totaling 100', () => {
  for (const chest of DEFAULT_CHEST_TYPES) {
    assert.equal(chest.rewardTable.reduce((sum, reward) => sum + reward.weight, 0), 100);
  }
});

Deno.test('chest cart uses one Silver-or-higher discount and reaches zero resources', () => {
  const result = quoteChestCart({
    gold: 500,
    gems: 1,
    cart: [
      { key: 'copper', quantity: 3 },
      { key: 'silver', quantity: 1 },
      { key: 'crystal', quantity: 1 },
    ],
    discountTarget: 'silver',
  });

  assert.equal(result.ok, true);
  assert.equal(result.totalGold, 500);
  assert.equal(result.totalGems, 1);
  assert.equal(result.remainingGold, 0);
  assert.equal(result.remainingGems, 0);
});

Deno.test('reward boost event returns an expiring effect', () => {
  assert.deepEqual(applyEvent({ code: 'reward_boost_20' }), {
    code: 'reward_boost_20',
    durationRounds: 2,
  });
});
