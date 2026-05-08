import { create } from "zustand";
import { persist } from "zustand/middleware";

interface GameState {
  balance: number;
  gameConfigId: string;
  setBalance: (balance: number) => void;
  setGameConfigId: (id: string) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      balance: 0,
      gameConfigId: "",
      setBalance: (balance) => set({ balance }),
      setGameConfigId: (gameConfigId) => set({ gameConfigId }),
    }),
    { name: "scatterx-game" }
  )
);
