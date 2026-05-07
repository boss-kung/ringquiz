import type {
  ScoreBreakdownItem,
  SpecialRuleConfig,
  SpecialRuleType,
} from './types.ts';

const RULE_DEFAULTS: Record<SpecialRuleType, SpecialRuleConfig> = {
  normal: {},
  double_score: { multiplier: 2 },
  triple_score: { multiplier: 3 },
  speed_bonus: { bonus_ratio: 0.5, max_bonus_points: 500 },
  no_mistake: { wrong_penalty_points: -200, penalize_no_answer: false, allow_negative_total_score: false },
  fastest_finger: { top_n: 3, bonus_points: 300 },
  mystery_multiplier: { multiplier: 2, hidden_until_reveal: true },
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function toRuleConfig(rawConfig: unknown) {
  return rawConfig && typeof rawConfig === 'object' ? rawConfig as Record<string, unknown> : {};
}

export function normalizeSpecialRuleConfig(type: SpecialRuleType, rawConfig: unknown): SpecialRuleConfig {
  const raw = toRuleConfig(rawConfig);
  const defaults = RULE_DEFAULTS[type];

  return {
    multiplier: type === 'double_score' || type === 'triple_score' || type === 'mystery_multiplier'
      ? clampNumber(raw.multiplier, 1, 5, defaults.multiplier ?? 2)
      : undefined,
    bonus_ratio: type === 'speed_bonus'
      ? clampNumber(raw.bonus_ratio, 0, 2, defaults.bonus_ratio ?? 0.5)
      : undefined,
    max_bonus_points: type === 'speed_bonus'
      ? clampNumber(raw.max_bonus_points, 0, 5000, defaults.max_bonus_points ?? 500)
      : undefined,
    wrong_penalty_points: type === 'no_mistake'
      ? clampNumber(raw.wrong_penalty_points, -5000, 0, defaults.wrong_penalty_points ?? -200)
      : undefined,
    penalize_no_answer: type === 'no_mistake'
      ? Boolean(raw.penalize_no_answer ?? defaults.penalize_no_answer)
      : undefined,
    allow_negative_total_score: type === 'no_mistake'
      ? Boolean(raw.allow_negative_total_score ?? defaults.allow_negative_total_score)
      : undefined,
    top_n: type === 'fastest_finger'
      ? clampNumber(raw.top_n, 1, 20, defaults.top_n ?? 3)
      : undefined,
    bonus_points: type === 'fastest_finger'
      ? clampNumber(raw.bonus_points, 0, 5000, defaults.bonus_points ?? 300)
      : undefined,
    hidden_until_reveal: type === 'mystery_multiplier'
      ? Boolean(raw.hidden_until_reveal ?? defaults.hidden_until_reveal)
      : undefined,
  };
}

export function buildScoreBreakdown(...items: ScoreBreakdownItem[]) {
  return items.filter((item) => Number.isFinite(item.value));
}

export function calculateScoreWithSpecialRule({
  type,
  rawConfig,
  isCorrect,
  baseScore,
  timeRemainingRatio,
  currentTotalScore,
}: {
  type: SpecialRuleType;
  rawConfig: unknown;
  isCorrect: boolean;
  baseScore: number;
  timeRemainingRatio: number;
  currentTotalScore: number;
}) {
  const config = normalizeSpecialRuleConfig(type, rawConfig);
  const breakdown: ScoreBreakdownItem[] = [
    { type: 'base', label: 'Base Score', value: baseScore },
  ];

  let finalScore = baseScore;
  let specialBonusApplied = false;

  if (type === 'double_score' && isCorrect) {
    finalScore = baseScore * (config.multiplier ?? 2);
    specialBonusApplied = true;
    breakdown.push({ type: 'multiplier', label: 'Double Score', value: finalScore - baseScore, operation: `x${config.multiplier ?? 2}` });
  } else if (type === 'triple_score' && isCorrect) {
    finalScore = baseScore * (config.multiplier ?? 3);
    specialBonusApplied = true;
    breakdown.push({ type: 'multiplier', label: 'Triple Score', value: finalScore - baseScore, operation: `x${config.multiplier ?? 3}` });
  } else if (type === 'speed_bonus' && isCorrect) {
    const uncappedBonus = Math.round(baseScore * (config.bonus_ratio ?? 0.5) * timeRemainingRatio);
    const bonus = Math.min(uncappedBonus, config.max_bonus_points ?? 500);
    finalScore = baseScore + bonus;
    specialBonusApplied = bonus > 0;
    breakdown.push({ type: 'speed_bonus', label: 'Speed Bonus', value: bonus, operation: `+${bonus}` });
  } else if (type === 'no_mistake' && !isCorrect) {
    finalScore = config.wrong_penalty_points ?? -200;
    breakdown.push({ type: 'penalty', label: 'Wrong Answer Penalty', value: finalScore });
    if (!config.allow_negative_total_score) {
      const clampedScore = Math.max(finalScore, -currentTotalScore);
      if (clampedScore !== finalScore) {
        breakdown.push({ type: 'clamp', label: 'Score Floor Clamp', value: clampedScore - finalScore, operation: 'floor 0' });
        finalScore = clampedScore;
      }
    }
  } else if (type === 'mystery_multiplier' && isCorrect) {
    finalScore = baseScore * (config.multiplier ?? 2);
    specialBonusApplied = true;
    breakdown.push({ type: 'multiplier', label: 'Mystery Multiplier', value: finalScore - baseScore, operation: `x${config.multiplier ?? 2}` });
  }

  breakdown.push({ type: 'final', label: 'Final Score', value: finalScore });

  return {
    finalScore,
    normalizedConfig: config,
    scoreBreakdown: buildScoreBreakdown(...breakdown),
    specialBonusApplied,
  };
}
