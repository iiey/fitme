"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AthleteListItem } from "./types";

const STORAGE_KEY = "strastat-athlete-id";

interface AthleteContextValue {
  athleteId: string | null;
  setAthleteId: (id: string | null) => void;
  athletes: AthleteListItem[];
  setAthletes: (list: AthleteListItem[]) => void;
}

const AthleteContext = createContext<AthleteContextValue>({
  athleteId: null,
  setAthleteId: () => {},
  athletes: [],
  setAthletes: () => {},
});

export function AthleteProvider({ children }: { children: React.ReactNode }) {
  const [athleteId, setAthleteIdState] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<AthleteListItem[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setAthleteIdState(stored);
    setInitialized(true);
  }, []);

  const setAthleteId = useCallback((id: string | null) => {
    setAthleteIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  if (!initialized) return null;

  return (
    <AthleteContext.Provider value={{ athleteId, setAthleteId, athletes, setAthletes }}>
      {children}
    </AthleteContext.Provider>
  );
}

export function useAthleteContext() {
  return useContext(AthleteContext);
}
