import type { ScoreBreakdownItem, SpecialRuleConfig, SpecialRuleType } from './types';

export type SpecialRulePhase = 'countdown' | 'clue' | 'question' | 'reveal' | 'leaderboard';

export interface SpecialRulePresentation {
  label: string;
  shortLabel: string;
  description: string;
  playerMessage: string;
  bigScreenMessage: string;
  revealMessage: string;
  theme: 'neutral' | 'double' | 'triple' | 'speed' | 'danger' | 'fastest' | 'mystery';
  icon: string;
  shouldHideValueBeforeReveal: boolean;
}

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

function formatSignedPoints(value: number) {
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
}

export function hasSpecialRule(type: SpecialRuleType | null | undefined) {
  return Boolean(type && type !== 'normal');
}

export function normalizeSpecialRuleConfig(type: SpecialRuleType, rawConfig: unknown): SpecialRuleConfig {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig as Record<string, unknown> : {};
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

export function getSpecialRulePresentation(
  type: SpecialRuleType,
  rawConfig: SpecialRuleConfig | null | undefined,
  phase: SpecialRulePhase,
): SpecialRulePresentation | null {
  if (type === 'normal') return null;
  const config = normalizeSpecialRuleConfig(type, rawConfig);

  switch (type) {
    case 'double_score':
      return {
        label: 'DOUBLE SCORE',
        shortLabel: 'x2',
        description: 'ตอบถูก คะแนนคูณ 2',
        playerMessage: 'DOUBLE SCORE · ตอบถูก คะแนนคูณ 2',
        bigScreenMessage: 'ตอบถูก คะแนนคูณ 2',
        revealMessage: 'คะแนนคูณ 2',
        theme: 'double',
        icon: '✦',
        shouldHideValueBeforeReveal: false,
      };
    case 'triple_score':
      return {
        label: 'TRIPLE SCORE',
        shortLabel: 'x3',
        description: 'ตอบถูก คะแนนคูณ 3',
        playerMessage: 'TRIPLE SCORE · ตอบถูก คะแนนคูณ 3',
        bigScreenMessage: 'ตอบถูก คะแนนคูณ 3',
        revealMessage: 'คะแนนคูณ 3',
        theme: 'triple',
        icon: '✸',
        shouldHideValueBeforeReveal: false,
      };
    case 'speed_bonus':
      return {
        label: 'SPEED BONUS',
        shortLabel: 'SPEED',
        description: 'ตอบถูกไว ได้โบนัสเพิ่ม',
        playerMessage: 'SPEED BONUS · ตอบถูกไว ได้โบนัสเพิ่ม',
        bigScreenMessage: 'ตอบถูกไว ได้โบนัสเพิ่ม',
        revealMessage: 'โบนัสความเร็วถูกนำมาคิดคะแนนแล้ว',
        theme: 'speed',
        icon: '⚡',
        shouldHideValueBeforeReveal: false,
      };
    case 'no_mistake':
      return {
        label: 'NO MISTAKE',
        shortLabel: 'DANGER',
        description: `ตอบผิดเสีย ${Math.abs(config.wrong_penalty_points ?? -200).toLocaleString()} คะแนน`,
        playerMessage: `NO MISTAKE · ตอบผิดเสีย ${Math.abs(config.wrong_penalty_points ?? -200).toLocaleString()} คะแนน`,
        bigScreenMessage: `ตอบผิดเสีย ${Math.abs(config.wrong_penalty_points ?? -200).toLocaleString()} คะแนน`,
        revealMessage: `รอบนี้มีโทษตอบผิด ${Math.abs(config.wrong_penalty_points ?? -200).toLocaleString()} คะแนน`,
        theme: 'danger',
        icon: '⚠',
        shouldHideValueBeforeReveal: false,
      };
    case 'fastest_finger':
      return {
        label: 'FASTEST FINGER',
        shortLabel: 'FASTEST',
        description: `${config.top_n ?? 3} คนแรกที่ตอบถูก ได้โบนัส ${formatSignedPoints(config.bonus_points ?? 300)}`,
        playerMessage: `FASTEST FINGER · ${config.top_n ?? 3} คนแรกที่ตอบถูก ได้โบนัส ${formatSignedPoints(config.bonus_points ?? 300)}`,
        bigScreenMessage: `${config.top_n ?? 3} คนแรกที่ตอบถูก ได้โบนัส ${formatSignedPoints(config.bonus_points ?? 300)}`,
        revealMessage: `โบนัส ${formatSignedPoints(config.bonus_points ?? 300)} สำหรับ ${config.top_n ?? 3} คนแรก`,
        theme: 'fastest',
        icon: '🏁',
        shouldHideValueBeforeReveal: false,
      };
    case 'mystery_multiplier': {
      const hidden = Boolean(config.hidden_until_reveal);
      const multiplier = config.multiplier ?? 2;
      const revealMode = phase === 'reveal' || phase === 'leaderboard' || !hidden;
      return {
        label: revealMode ? 'MYSTERY REVEALED' : 'MYSTERY MULTIPLIER',
        shortLabel: revealMode ? `x${multiplier}` : 'MYSTERY',
        description: revealMode ? `คะแนนคูณ ${multiplier}` : 'ตัวคูณคะแนนจะเปิดตอนเฉลย',
        playerMessage: revealMode ? `MYSTERY REVEALED · x${multiplier}` : 'MYSTERY MULTIPLIER · เปิดตัวคูณตอนเฉลย',
        bigScreenMessage: revealMode ? `คะแนนคูณ ${multiplier}` : 'ตัวคูณคะแนนจะเปิดตอนเฉลย',
        revealMessage: `MYSTERY REVEALED · x${multiplier}`,
        theme: 'mystery',
        icon: '🎭',
        shouldHideValueBeforeReveal: hidden,
      };
    }
    default:
      return null;
  }
}

export function formatScoreBreakdown(items: ScoreBreakdownItem[] | null | undefined) {
  return items ?? [];
}
