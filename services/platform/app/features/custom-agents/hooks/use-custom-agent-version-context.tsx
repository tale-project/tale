'use client';

import { createContext, useContext, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

interface CustomAgentVersionContextValue {
  agent: Doc<'customAgents'>;
  versions: Doc<'customAgents'>[];
  isReadOnly: boolean;
  hasDraft: boolean;
  hasActiveVersion: boolean;
  draftVersionNumber: number | undefined;
}

const CustomAgentVersionContext =
  createContext<CustomAgentVersionContextValue | null>(null);

export function useCustomAgentVersion() {
  const ctx = useContext(CustomAgentVersionContext);
  if (!ctx) {
    throw new Error(
      'useCustomAgentVersion must be used within CustomAgentVersionProvider',
    );
  }
  return ctx;
}

interface CustomAgentVersionProviderProps {
  agent: Doc<'customAgents'>;
  versions: Doc<'customAgents'>[];
  children: React.ReactNode;
}

export function CustomAgentVersionProvider({
  agent,
  versions,
  children,
}: CustomAgentVersionProviderProps) {
  const value = useMemo<CustomAgentVersionContextValue>(() => {
    const hasDraft = versions.some((v) => v.status === 'draft');
    const hasActiveVersion = versions.some((v) => v.status === 'active');
    const draft = versions.find((v) => v.status === 'draft');

    return {
      agent,
      versions,
      isReadOnly: agent.status !== 'draft',
      hasDraft,
      hasActiveVersion,
      draftVersionNumber: draft?.versionNumber,
    };
  }, [agent, versions]);

  return (
    <CustomAgentVersionContext.Provider value={value}>
      {children}
    </CustomAgentVersionContext.Provider>
  );
}
