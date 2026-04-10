'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

type Verdict = 'a_better' | 'b_better' | 'tie' | 'both_bad';

interface ArenaModeContextType {
  isArenaMode: boolean;
  modelA: string | null;
  modelB: string | null;
  setModelA: (modelId: string | null) => void;
  setModelB: (modelId: string | null) => void;
  enableArenaMode: () => void;
  disableArenaMode: () => void;
  arenaThreadIdA: string | null;
  arenaThreadIdB: string | null;
  setArenaThreadIdA: (threadId: string | null) => void;
  setArenaThreadIdB: (threadId: string | null) => void;
  verdict: Verdict | null;
  setVerdict: (verdict: Verdict | null) => void;
}

const ArenaModeContext = createContext<ArenaModeContextType | null>(null);

export function useArenaMode() {
  const context = useContext(ArenaModeContext);
  if (!context) {
    throw new Error('useArenaMode must be used within ArenaModeProvider');
  }
  return context;
}

export function useArenaModeOptional() {
  return useContext(ArenaModeContext);
}

interface ArenaModeProviderProps {
  children: ReactNode;
}

export function ArenaModeProvider({ children }: ArenaModeProviderProps) {
  const [isArenaMode, setIsArenaMode] = useState(false);
  const [modelA, setModelA] = useState<string | null>(null);
  const [modelB, setModelB] = useState<string | null>(null);
  const [arenaThreadIdA, setArenaThreadIdA] = useState<string | null>(null);
  const [arenaThreadIdB, setArenaThreadIdB] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const enableArenaMode = useCallback(() => {
    setIsArenaMode(true);
  }, []);

  const disableArenaMode = useCallback(() => {
    setIsArenaMode(false);
    setModelA(null);
    setModelB(null);
    setArenaThreadIdA(null);
    setArenaThreadIdB(null);
    setVerdict(null);
  }, []);

  const value = useMemo(
    () => ({
      isArenaMode,
      modelA,
      modelB,
      setModelA,
      setModelB,
      enableArenaMode,
      disableArenaMode,
      arenaThreadIdA,
      arenaThreadIdB,
      setArenaThreadIdA,
      setArenaThreadIdB,
      verdict,
      setVerdict,
    }),
    [
      isArenaMode,
      modelA,
      modelB,
      enableArenaMode,
      disableArenaMode,
      arenaThreadIdA,
      arenaThreadIdB,
      verdict,
    ],
  );

  return (
    <ArenaModeContext.Provider value={value}>
      {children}
    </ArenaModeContext.Provider>
  );
}
