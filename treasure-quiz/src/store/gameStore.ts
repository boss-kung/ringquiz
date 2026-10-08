import { create } from 'zustand';
import type { GameSnapshot } from '../domain/types';

interface GameStore {
  game: GameSnapshot | null;
  playerConnected: boolean;
  setGame: (game: GameSnapshot | null) => void;
  patchGame: (patch: Partial<GameSnapshot>) => void;
  setPlayerConnected: (connected: boolean) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  game: null,
  playerConnected: false,
  setGame: (game) => set({ game }),
  patchGame: (patch) => set((state) => ({ game: state.game ? { ...state.game, ...patch } : null })),
  setPlayerConnected: (playerConnected) => set({ playerConnected }),
}));
