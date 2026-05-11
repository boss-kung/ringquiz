import type { GameStatus, HostActionName, SpecialRuleType } from './types';

export interface OperatorStep {
  phaseLabelTh: string;
  phaseColor: string;
  statusDescriptionTh: string;
  primaryAction: HostActionName | null;
  primaryActionLabelTh: string;
  primaryActionDescriptionTh: string;
  disabledReasonTh: string | null; // null → action is enabled
  riskLevel: 'safe' | 'caution';
  warnings: string[];
}

export interface OperatorContext {
  totalQuestions: number;
  hasActiveGameSet: boolean;
  playerCount: number;
  submittedCount: number;
  timeLeft: number | null;
  isLastQuestion: boolean;
}

export function getOperatorStep(rawStatus: string, ctx: OperatorContext): OperatorStep {
  const { totalQuestions, hasActiveGameSet, playerCount, submittedCount, timeLeft, isLastQuestion } = ctx;
  const unanswered = Math.max(0, playerCount - submittedCount);
  const warnings: string[] = [];

  switch (rawStatus as GameStatus | 'loading') {
    case 'loading':
      return {
        phaseLabelTh: 'กำลังโหลด',
        phaseColor: 'var(--text-3)',
        statusDescriptionTh: 'กำลังเชื่อมต่อกับเซิร์ฟเวอร์...',
        primaryAction: null,
        primaryActionLabelTh: 'กำลังโหลด...',
        primaryActionDescriptionTh: '',
        disabledReasonTh: 'กำลังโหลดสถานะเกม',
        riskLevel: 'safe',
        warnings: [],
      };

    case 'waiting': {
      let disabledReason: string | null = null;
      if (!hasActiveGameSet) disabledReason = 'ยังไม่ได้เลือกชุดคำถาม → ไปที่แท็บ Game Setup';
      else if (totalQuestions === 0) disabledReason = 'ชุดคำถามยังไม่มีข้อ กรุณาเพิ่มคำถามก่อน';
      if (playerCount === 0) warnings.push('ยังไม่มีผู้เล่นเข้าร่วม');
      return {
        phaseLabelTh: 'รอผู้เล่นเข้าร่วม',
        phaseColor: 'var(--text-2)',
        statusDescriptionTh: hasActiveGameSet
          ? `มีผู้เล่น ${playerCount} คนในล็อบบี้`
          : 'ยังไม่ได้เลือกชุดคำถาม',
        primaryAction: 'start_countdown',
        primaryActionLabelTh: 'เริ่มนับถอยหลัง',
        primaryActionDescriptionTh: 'เปิดภาพใบ้บนจอหลัก และเริ่มนับถอยหลังก่อนรับคำตอบ',
        disabledReasonTh: disabledReason,
        riskLevel: 'safe',
        warnings,
      };
    }

    case 'countdown':
      return {
        phaseLabelTh: 'กำลังนับถอยหลัง',
        phaseColor: 'var(--indigo)',
        statusDescriptionTh: 'กำลังแสดงภาพใบ้บนจอหลัก',
        primaryAction: 'open_question',
        primaryActionLabelTh: 'เปิดรับคำตอบ',
        primaryActionDescriptionTh: 'เปิดให้ผู้เล่นกดตำแหน่งคำตอบบนมือถือได้ทันที',
        disabledReasonTh: null,
        riskLevel: 'safe',
        warnings,
      };

    case 'question_open':
      if (unanswered > 0) warnings.push(`ยังมี ${unanswered} คนที่ยังไม่ตอบ`);
      return {
        phaseLabelTh: 'รับคำตอบอยู่',
        phaseColor: 'var(--emerald)',
        statusDescriptionTh: timeLeft !== null ? `เหลือเวลา ${timeLeft} วินาที` : 'กำลังรับคำตอบ',
        primaryAction: 'close_question',
        primaryActionLabelTh: 'ปิดรับคำตอบ',
        primaryActionDescriptionTh: 'หยุดรับคำตอบ และเตรียมแสดงผลเฉลย',
        disabledReasonTh: null,
        riskLevel: 'caution',
        warnings,
      };

    case 'question_closed':
      return {
        phaseLabelTh: 'ปิดรับคำตอบแล้ว',
        phaseColor: 'var(--gold)',
        statusDescriptionTh: `ตอบแล้ว ${submittedCount}/${playerCount} คน`,
        primaryAction: 'show_reveal',
        primaryActionLabelTh: 'เฉลยคำตอบ',
        primaryActionDescriptionTh: 'แสดงตำแหน่งที่ถูกต้องบนจอผู้เล่นทุกคน',
        disabledReasonTh: null,
        riskLevel: 'safe',
        warnings,
      };

    case 'reveal':
      return {
        phaseLabelTh: 'กำลังเฉลยคำตอบ',
        phaseColor: 'var(--gold)',
        statusDescriptionTh: 'จอแสดงตำแหน่งที่ถูกต้องอยู่',
        primaryAction: 'show_leaderboard',
        primaryActionLabelTh: 'แสดงอันดับคะแนน',
        primaryActionDescriptionTh: 'แสดงตารางอันดับผู้เล่นบนจอหลัก',
        disabledReasonTh: null,
        riskLevel: 'safe',
        warnings,
      };

    case 'leaderboard':
      if (isLastQuestion) {
        return {
          phaseLabelTh: 'แสดงอันดับ · ข้อสุดท้าย',
          phaseColor: 'var(--gold)',
          statusDescriptionTh: 'ข้อสุดท้ายแล้ว พร้อมจบเกมเมื่อต้องการ',
          primaryAction: 'end_game',
          primaryActionLabelTh: 'จบเกม',
          primaryActionDescriptionTh: 'ปิดเกม แสดงผลสุดท้ายบนจอหลัก',
          disabledReasonTh: null,
          riskLevel: 'caution',
          warnings,
        };
      }
      return {
        phaseLabelTh: 'แสดงอันดับคะแนน',
        phaseColor: 'var(--indigo)',
        statusDescriptionTh: 'กำลังแสดงอันดับอยู่',
        primaryAction: 'next_question',
        primaryActionLabelTh: 'ข้อถัดไป →',
        primaryActionDescriptionTh: 'ข้ามไปเริ่มนับถอยหลังข้อถัดไปทันที',
        disabledReasonTh: null,
        riskLevel: 'safe',
        warnings,
      };

    case 'ended':
      return {
        phaseLabelTh: 'เกมจบแล้ว',
        phaseColor: 'var(--gold)',
        statusDescriptionTh: 'เกมสิ้นสุดแล้ว',
        primaryAction: null,
        primaryActionLabelTh: '—',
        primaryActionDescriptionTh: 'ใช้ Emergency Controls เพื่อรีเซ็ตเกม',
        disabledReasonTh: 'เกมจบแล้ว',
        riskLevel: 'safe',
        warnings,
      };

    default:
      return {
        phaseLabelTh: 'ไม่ทราบสถานะ',
        phaseColor: 'var(--rose)',
        statusDescriptionTh: `สถานะไม่รู้จัก กรุณารีเฟรชหน้าจอ`,
        primaryAction: null,
        primaryActionLabelTh: '—',
        primaryActionDescriptionTh: '',
        disabledReasonTh: 'ไม่ทราบสถานะ',
        riskLevel: 'safe',
        warnings: ['สถานะเกมไม่ถูกต้อง กรุณารีเฟรชหน้าจอ'],
      };
  }
}

export function getSpecialRuleLabelTh(ruleType: SpecialRuleType | string | null | undefined): string {
  switch (ruleType) {
    case 'double_score':       return '✕2 คะแนนสองเท่า';
    case 'triple_score':       return '✕3 คะแนนสามเท่า';
    case 'speed_bonus':        return '⚡ โบนัสความเร็ว';
    case 'no_mistake':         return '⚠ ห้ามผิด';
    case 'fastest_finger':     return '🏆 เร็วที่สุด';
    case 'mystery_multiplier': return '❓ ตัวคูณลึกลับ';
    case 'normal':
    default:                   return '';
  }
}
