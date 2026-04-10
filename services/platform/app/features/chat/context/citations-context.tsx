'use client';

import { createContext, useContext } from 'react';

import type { CitationInfo } from '../hooks/use-citations';

interface CitationsContextValue {
  citations: Map<number, CitationInfo>;
  onNavigate?: (fileId: string, page?: number) => void;
}

export const CitationsContext = createContext<CitationsContextValue>({
  citations: new Map(),
});

export function useCitationsContext() {
  return useContext(CitationsContext);
}
