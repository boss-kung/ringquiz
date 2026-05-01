import { create } from 'zustand';
import type {
  GameState,
  Question,
  LeaderboardEntry,
  SubmitAnswerResponse,
  CirclePosition,
  RevealResult,
} from '../lib/types';

interface GameStore {
  // Game state (from Realtime)
  gameState: GameState | null;
  setGameState: (gs: GameState) => void;

  // Current question (fetched when question_id changes)
  question: Question | null;
  setQuestion: (q: Question | null) => void;

  // Player session
  playerId: string | null;
  displayName: string | null;
  isJoined: boolean;
  setSession: (playerId: string, displayName: string) => void;

  // Server time: Date.now() + serverTimeOffset ≈ server time in ms
  serverTimeOffset: number;
  setServerTimeOffset: (offset: number) => void;

  // Answer state (reset when question changes)
  circlePosition: CirclePosition | null;
  setCirclePosition: (pos: CirclePosition | null) => void;
  submitted: boolean;
  submitResult: SubmitAnswerResponse | null;
  submitError: string | null;
  setSubmitResult: (r: SubmitAnswerResponse) => void;
  setSubmitError: (e: string | null) => void;
  resetAnswerState: () => void;

  // Reveal (own result for current question)
  revealResult: RevealResult | null;
  setRevealResult: (r: RevealResult | null) => void;
  revealNoAnswer: boolean;
  setRevealNoAnswer: (v: boolean) => void;

  // Leaderboard
  leaderboard: LeaderboardEntry[];
  playerLeaderboardEntry: LeaderboardEntry | null;
  setLeaderboard: (entries: LeaderboardEntry[], playerId: string | null) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  gameState: null,
  setGameState: (gs) => set({ gameState: gs }),

  question: null,
  setQuestion: (q) => set({ question: q }),

  playerId: null,
  displayName: null,
  isJoined: false,
  setSession: (playerId, displayName) =>
    set({ playerId, displayName, isJoined: true }),

  serverTimeOffset: 0,
  setServerTimeOffset: (offset) => set({ serverTimeOffset: offset }),

  circlePosition: null,
  setCirclePosition: (pos) => set({ circlePosition: pos }),
  submitted: false,
  submitResult: null,
  submitError: null,
  setSubmitResult: (r) => set({ submitResult: r, submitted: true, submitError: null }),
  setSubmitError: (e) => set({ submitError: e }),
  resetAnswerState: () =>
    set({ circlePosition: null, submitted: false, submitResult: null, submitError: null, revealNoAnswer: false }),

  revealResult: null,
  setRevealResult: (r) => set({ revealResult: r, revealNoAnswer: false }),
  revealNoAnswer: false,
  setRevealNoAnswer: (v) => set({ revealNoAnswer: v }),

  leaderboard: [],
  playerLeaderboardEntry: null,
  setLeaderboard: (entries, playerId) =>
    set({
      leaderboard: entries,
      playerLeaderboardEntry: playerId
        ? (entries.find((e) => e.player_id === playerId) ?? null)
        : null,
    }),
}));
