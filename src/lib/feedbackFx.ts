export type FeedbackFxEventName =
  | 'joinSuccess'
  | 'countdownStart'
  | 'answerOpen'
  | 'answerTap'
  | 'answerLocked'
  | 'answerCorrect'
  | 'answerWrong'
  | 'timeout'
  | 'reveal'
  | 'leaderboardShow'
  | 'timerTickUrgent';

export interface FeedbackFxDetail {
  clientX?: number;
  clientY?: number;
}

const FX_EVENT_NAME = 'ringquiz:feedback-fx';
const SOUND_SETTING_KEY = 'soundFxEnabled';
const MIN_EVENT_GAP_MS = 120;

const vibratePatterns: Partial<Record<FeedbackFxEventName, number | number[]>> = {
  joinSuccess: [18],
  countdownStart: [20, 40, 20],
  answerOpen: [12],
  answerTap: [8],
  answerLocked: [14, 30, 14],
  answerCorrect: [24, 40, 24, 60, 30],
  answerWrong: [40, 40, 22],
  timeout: [30, 45, 30],
  reveal: [18, 30, 18],
  leaderboardShow: [18, 50, 30],
  timerTickUrgent: [10],
};

const audioProfiles: Partial<Record<FeedbackFxEventName, { frequency: number; durationMs: number; type?: OscillatorType }>> = {
  joinSuccess: { frequency: 660, durationMs: 90, type: 'sine' },
  answerLocked: { frequency: 420, durationMs: 80, type: 'triangle' },
  answerCorrect: { frequency: 880, durationMs: 140, type: 'sine' },
  answerWrong: { frequency: 220, durationMs: 120, type: 'sawtooth' },
  timeout: { frequency: 180, durationMs: 160, type: 'square' },
  leaderboardShow: { frequency: 740, durationMs: 120, type: 'triangle' },
};

const lastTriggeredAt = new Map<FeedbackFxEventName, number>();
let audioUnlocked = false;
let audioContext: AudioContext | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function shouldThrottle(event: FeedbackFxEventName): boolean {
  const now = Date.now();
  const prev = lastTriggeredAt.get(event) ?? 0;
  if (now - prev < MIN_EVENT_GAP_MS) {
    return true;
  }
  lastTriggeredAt.set(event, now);
  return false;
}

function getAudioContext(): AudioContext | null {
  if (!isBrowser()) return null;
  if (audioContext) return audioContext;

  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  audioContext = new AudioCtx();
  return audioContext;
}

function playAudioCue(event: FeedbackFxEventName) {
  const profile = audioProfiles[event];
  if (!profile || !audioUnlocked || !isSoundFxEnabled()) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = profile.type ?? 'sine';
  oscillator.frequency.setValueAtTime(profile.frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.durationMs / 1000);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + profile.durationMs / 1000 + 0.02);
}

export function isSoundFxEnabled(): boolean {
  if (!isBrowser()) return false;
  return window.localStorage.getItem(SOUND_SETTING_KEY) === 'true';
}

export function setSoundFxEnabled(enabled: boolean) {
  if (!isBrowser()) return;
  window.localStorage.setItem(SOUND_SETTING_KEY, enabled ? 'true' : 'false');
}

export async function unlockFeedbackAudio() {
  audioUnlocked = true;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // ignore — sound remains optional
    }
  }
}

export function triggerFeedbackFx(event: FeedbackFxEventName, detail: FeedbackFxDetail = {}) {
  if (!isBrowser() || shouldThrottle(event)) return;

  const pattern = vibratePatterns[event];
  if (pattern && canVibrate()) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // iOS Safari has no vibrate support — stay silent safely.
    }
  }

  playAudioCue(event);

  window.dispatchEvent(
    new CustomEvent(FX_EVENT_NAME, {
      detail: { event, ...detail },
    }),
  );
}

export function subscribeFeedbackFx(listener: (event: FeedbackFxEventName, detail: FeedbackFxDetail) => void) {
  if (!isBrowser()) return () => {};

  const handler = (raw: Event) => {
    const custom = raw as CustomEvent<FeedbackFxDetail & { event: FeedbackFxEventName }>;
    listener(custom.detail.event, custom.detail);
  };

  window.addEventListener(FX_EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(FX_EVENT_NAME, handler as EventListener);
}
