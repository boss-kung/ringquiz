import { useSyncExternalStore } from 'react';

export type DisplayAudioCue =
  | 'lobbyLoop'
  | 'playerJoin'
  | 'countdownTick'
  | 'countdownFinalHit'
  | 'questionOpen'
  | 'timerTickFast'
  | 'answerLocked'
  | 'drumroll'
  | 'revealHit'
  | 'leaderboardIntro'
  | 'rankMove'
  | 'newLeader'
  | 'finalIntro'
  | 'winnerFanfare'
  | 'confettiPop'
  | 'uiClick';

interface DisplayAudioPlayOptions {
  volume?: number;
  restart?: boolean;
}

interface DisplayAudioLoopOptions {
  volume?: number;
}

export interface DisplayAudioController {
  isEnabled(): boolean;
  isMuted(): boolean;
  enable(): Promise<boolean>;
  mute(): void;
  unmute(): void;
  setMuted(next: boolean): void;
  setVolume(next: number): void;
  getVolume(): number;
  play(cue: DisplayAudioCue, options?: DisplayAudioPlayOptions): void;
  startLoop(cue: 'lobbyLoop', options?: DisplayAudioLoopOptions): void;
  stopLoop(cue?: 'lobbyLoop'): void;
  stopAll(): void;
}

type Listener = () => void;

const ENABLED_KEY = 'ringquiz.displayAudio.enabled';
const MUTED_KEY = 'ringquiz.displayAudio.muted';
const VOLUME_KEY = 'ringquiz.displayAudio.volume';
const DEFAULT_VOLUME = 0.55;

const AUDIO_PATHS: Record<DisplayAudioCue, string> = {
  lobbyLoop: '/audio/sfx/lobby_loop.mp3',
  playerJoin: '/audio/sfx/player_join.mp3',
  countdownTick: '/audio/sfx/countdown_tick.mp3',
  countdownFinalHit: '/audio/sfx/countdown_final_hit.mp3',
  questionOpen: '/audio/sfx/question_open.mp3',
  timerTickFast: '/audio/sfx/timer_tick_fast.mp3',
  answerLocked: '/audio/sfx/answer_locked.mp3',
  drumroll: '/audio/sfx/drumroll.mp3',
  revealHit: '/audio/sfx/reveal_hit.mp3',
  leaderboardIntro: '/audio/sfx/leaderboard_intro.mp3',
  rankMove: '/audio/sfx/rank_move.mp3',
  newLeader: '/audio/sfx/new_leader.mp3',
  finalIntro: '/audio/sfx/final_intro.mp3',
  winnerFanfare: '/audio/sfx/winner_fanfare.mp3',
  confettiPop: '/audio/sfx/confetti_pop.mp3',
  uiClick: '/audio/sfx/ui_click.mp3',
};

const DEFAULT_CUE_VOLUMES: Record<DisplayAudioCue, number> = {
  lobbyLoop: 0.22,
  playerJoin: 0.46,
  countdownTick: 0.46,
  countdownFinalHit: 0.58,
  questionOpen: 0.48,
  timerTickFast: 0.35,
  answerLocked: 0.44,
  drumroll: 0.52,
  revealHit: 0.56,
  leaderboardIntro: 0.48,
  rankMove: 0.42,
  newLeader: 0.54,
  finalIntro: 0.6,
  winnerFanfare: 0.6,
  confettiPop: 0.5,
  uiClick: 0.36,
};

const MIN_GAP_MS: Partial<Record<DisplayAudioCue, number>> = {
  playerJoin: 250,
  countdownTick: 140,
  timerTickFast: 140,
  rankMove: 700,
  newLeader: 900,
  uiClick: 80,
};

const listeners = new Set<Listener>();
const missingWarnings = new Set<DisplayAudioCue>();
const baseAudio = new Map<DisplayAudioCue, HTMLAudioElement>();
const activeAudio = new Set<HTMLAudioElement>();
const recentPlayAt = new Map<DisplayAudioCue, number>();

let preferenceEnabled = readBoolean(ENABLED_KEY, false);
let muted = readBoolean(MUTED_KEY, false);
let volume = readNumber(VOLUME_KEY, DEFAULT_VOLUME);
let currentLoopCue: 'lobbyLoop' | null = null;
let currentLoopAudio: HTMLAudioElement | null = null;
let sessionUnlocked = false;

function isBrowser() {
  return typeof window !== 'undefined' && typeof Audio !== 'undefined';
}

function clampVolume(next: number) {
  if (!Number.isFinite(next)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, next));
}

function readBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw == null ? fallback : Number(raw);
    return clampVolume(parsed);
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage failures should not break the display screen
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function warnMissing(cue: DisplayAudioCue, src: string) {
  if (missingWarnings.has(cue)) return;
  missingWarnings.add(cue);
  console.warn(`[DisplayAudio] Missing or blocked audio file for "${cue}": ${src}`);
}

function resolveVolume(cue: DisplayAudioCue, override?: number) {
  return clampVolume((override ?? DEFAULT_CUE_VOLUMES[cue]) * volume);
}

function getBaseAudio(cue: DisplayAudioCue) {
  if (!isBrowser()) return null;
  const existing = baseAudio.get(cue);
  if (existing) return existing;

  const src = AUDIO_PATHS[cue];
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.addEventListener('error', () => warnMissing(cue, src), { once: true });
  baseAudio.set(cue, audio);
  return audio;
}

function primeAudioCache() {
  if (!isBrowser()) return;
  (Object.keys(AUDIO_PATHS) as DisplayAudioCue[]).forEach((cue) => {
    const audio = getBaseAudio(cue);
    audio?.load();
  });
}

function safePlay(audio: HTMLAudioElement) {
  try {
    const maybePromise = audio.play();
    if (maybePromise && typeof maybePromise.catch === 'function') {
      void maybePromise.catch(() => {});
    }
  } catch {
    // autoplay or decoding failures stay silent
  }
}

function resetAudio(audio: HTMLAudioElement) {
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // ignore
  }
}

function stopActiveAudio() {
  activeAudio.forEach((audio) => resetAudio(audio));
  activeAudio.clear();
}

const controller: DisplayAudioController = {
  isEnabled() {
    return preferenceEnabled && sessionUnlocked;
  },
  isMuted() {
    return muted;
  },
  async enable() {
    preferenceEnabled = true;
    sessionUnlocked = true;
    writeStorage(ENABLED_KEY, 'true');
    primeAudioCache();
    notify();
    return true;
  },
  mute() {
    controller.setMuted(true);
  },
  unmute() {
    controller.setMuted(false);
  },
  setMuted(next) {
    muted = next;
    writeStorage(MUTED_KEY, String(next));
    if (next) {
      controller.stopAll();
    }
    notify();
  },
  setVolume(next) {
    volume = clampVolume(next);
    writeStorage(VOLUME_KEY, String(volume));

    if (currentLoopAudio && currentLoopCue) {
      currentLoopAudio.volume = muted ? 0 : resolveVolume(currentLoopCue);
    }

    notify();
  },
  getVolume() {
    return volume;
  },
  play(cue, options) {
    if (!controller.isEnabled() || muted || !isBrowser()) return;

    const now = Date.now();
    const minGap = MIN_GAP_MS[cue] ?? 110;
    const lastPlayedAt = recentPlayAt.get(cue) ?? 0;
    if (now - lastPlayedAt < minGap) return;
    recentPlayAt.set(cue, now);

    if (cue === 'lobbyLoop') {
      controller.startLoop('lobbyLoop', options);
      return;
    }

    const base = getBaseAudio(cue);
    if (!base) return;

    const instance = new Audio(base.src);
    instance.preload = 'auto';
    instance.volume = resolveVolume(cue, options?.volume);
    instance.addEventListener('error', () => warnMissing(cue, AUDIO_PATHS[cue]), { once: true });

    const cleanup = () => {
      activeAudio.delete(instance);
    };

    instance.addEventListener('ended', cleanup, { once: true });
    instance.addEventListener('error', cleanup, { once: true });
    activeAudio.add(instance);

    if (options?.restart) {
      instance.currentTime = 0;
    }

    safePlay(instance);
  },
  startLoop(cue, options) {
    if (!controller.isEnabled() || muted || !isBrowser()) return;

    const src = AUDIO_PATHS[cue];
    if (!currentLoopAudio || currentLoopCue !== cue) {
      if (currentLoopAudio) {
        resetAudio(currentLoopAudio);
      }

      currentLoopAudio = new Audio(src);
      currentLoopAudio.loop = true;
      currentLoopAudio.preload = 'auto';
      currentLoopAudio.addEventListener('error', () => warnMissing(cue, src), { once: true });
      currentLoopCue = cue;
    }

    currentLoopAudio.volume = resolveVolume(cue, options?.volume);
    safePlay(currentLoopAudio);
  },
  stopLoop(cue) {
    if (!currentLoopAudio) return;
    if (cue && currentLoopCue !== cue) return;

    resetAudio(currentLoopAudio);
    currentLoopAudio = null;
    currentLoopCue = null;
  },
  stopAll() {
    controller.stopLoop();
    stopActiveAudio();
  },
};

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return { enabled: controller.isEnabled(), muted, volume };
}

export function createDisplayAudioController() {
  return controller;
}

export function useDisplayAudioController() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return controller;
}
