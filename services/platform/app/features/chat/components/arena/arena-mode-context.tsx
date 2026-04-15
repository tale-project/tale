'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

type Verdict = 'a_better' | 'b_better' | 'tie' | 'both_bad';

interface ArenaModeContextType {
  isArenaMode: boolean;
  isExitingArena: boolean;
  modelA: string | null;
  modelB: string | null;
  setModelA: (modelId: string | null) => void;
  setModelB: (modelId: string | null) => void;
  enableArenaMode: () => void;
  disableArenaMode: () => void;
  exitArenaMode: () => void;
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
  const [isExitingArena, setIsExitingArena] = useState(false);
  const [modelA, setModelA] = useState<string | null>(null);
  const [modelB, setModelB] = useState<string | null>(null);
  const [arenaThreadIdA, setArenaThreadIdA] = useState<string | null>(null);
  const [arenaThreadIdB, setArenaThreadIdB] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const enableArenaMode = useCallback(() => {
    setIsArenaMode(true);
  }, []);

  const { mutateAsync: cleanupArenaBranch } = useConvexMutation(
    api.threads.mutations.cleanupArenaBranch,
  );

  const disableArenaMode = useCallback(() => {
    setIsArenaMode(false);
    setModelA(null);
    setModelB(null);
    setArenaThreadIdA(null);
    setArenaThreadIdB(null);
    setVerdict(null);
  }, []);

  const exitArenaMode = useCallback(() => {
    // Capture values before clearing state
    const tidA = arenaThreadIdA;
    const tidB = arenaThreadIdB;
    const currentVerdict = verdict;

    // No backend state to clean up; exit immediately.
    if (!tidA || !tidB) {
      disableArenaMode();
      return;
    }

    // Show skeleton while the backend migrates messages and branch records.
    // Only flip arena off after the mutation settles so the UI doesn't flash
    // Thread A's pre-cleanup messages (especially under verdict='b_better').
    setIsExitingArena(true);
    void cleanupArenaBranch({
      threadIdA: tidA,
      threadIdB: tidB,
      verdict: currentVerdict ?? undefined,
    })
      .catch((err: unknown) => {
        console.error('[arena] cleanup failed:', err);
      })
      .finally(() => {
        disableArenaMode();
        setIsExitingArena(false);
      });
  }, [
    arenaThreadIdA,
    arenaThreadIdB,
    verdict,
    disableArenaMode,
    cleanupArenaBranch,
  ]);

  const value = useMemo(
    () => ({
      isArenaMode,
      isExitingArena,
      modelA,
      modelB,
      setModelA,
      setModelB,
      enableArenaMode,
      disableArenaMode,
      exitArenaMode,
      arenaThreadIdA,
      arenaThreadIdB,
      setArenaThreadIdA,
      setArenaThreadIdB,
      verdict,
      setVerdict,
    }),
    [
      isArenaMode,
      isExitingArena,
      modelA,
      modelB,
      enableArenaMode,
      disableArenaMode,
      exitArenaMode,
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
