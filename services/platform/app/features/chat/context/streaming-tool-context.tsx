'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface StreamingToolCall {
  toolCallId: string;
  toolName: string;
  /** Raw JSON string accumulated from tool-input-delta. */
  rawInput: string;
  state: 'input-streaming' | 'input-available';
}

interface StreamingToolContextValue {
  active: StreamingToolCall[];
  setActive: (next: StreamingToolCall[]) => void;
}

const StreamingToolContext = createContext<StreamingToolContextValue | null>(
  null,
);

export function useStreamingTools(): StreamingToolContextValue {
  const ctx = useContext(StreamingToolContext);
  if (!ctx) {
    return { active: [], setActive: () => {} };
  }
  return ctx;
}

interface StreamingToolProviderProps {
  children: ReactNode;
}

export function StreamingToolProvider({
  children,
}: StreamingToolProviderProps) {
  const [active, setActiveState] = useState<StreamingToolCall[]>([]);

  const setActive = useCallback((next: StreamingToolCall[]) => {
    setActiveState((prev) => (areEqual(prev, next) ? prev : next));
  }, []);

  const value = useMemo(() => ({ active, setActive }), [active, setActive]);

  return (
    <StreamingToolContext.Provider value={value}>
      {children}
    </StreamingToolContext.Provider>
  );
}

function areEqual(a: StreamingToolCall[], b: StreamingToolCall[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.toolCallId !== y.toolCallId ||
      x.toolName !== y.toolName ||
      x.state !== y.state ||
      x.rawInput !== y.rawInput
    ) {
      return false;
    }
  }
  return true;
}
