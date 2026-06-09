'use client';

import { createContext, useContext, useMemo } from 'react';

import { useConfigDirtyState } from '@/app/components/ui/editor/use-config-dirty-state';
import type { AgentJsonConfig } from '@/convex/agents/file_utils';

interface AgentConfigContextValue {
  agentName: string;
  config: AgentJsonConfig;
  initialConfig: AgentJsonConfig;
  isDirty: boolean;
  isSaving: boolean;
  updateConfig: (
    partial:
      | Partial<AgentJsonConfig>
      | ((prev: AgentJsonConfig) => Partial<AgentJsonConfig>),
  ) => void;
  resetConfig: () => void;
  markSaving: (saving: boolean) => void;
  markSaved: (persistedConfig: AgentJsonConfig) => void;
  overrideConfig: (config: AgentJsonConfig) => void;
}

const AgentConfigContext = createContext<AgentConfigContextValue | null>(null);

export function useAgentConfig() {
  const ctx = useContext(AgentConfigContext);
  if (!ctx) {
    throw new Error('useAgentConfig must be used within AgentConfigProvider');
  }
  return ctx;
}

interface AgentConfigProviderProps {
  agentName: string;
  initialConfig: AgentJsonConfig;
  children: React.ReactNode;
}

export function AgentConfigProvider({
  agentName,
  initialConfig,
  children,
}: AgentConfigProviderProps) {
  const {
    config,
    savedConfig,
    isDirty,
    isSaving,
    updateConfig,
    resetConfig,
    overrideConfig,
    markSaved,
    setIsSaving,
  } = useConfigDirtyState<AgentJsonConfig>({ initial: initialConfig });

  const value = useMemo<AgentConfigContextValue>(
    () => ({
      agentName,
      config,
      initialConfig: savedConfig,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      // `markSaving` is the legacy name for "set the in-flight flag". Save
      // orchestration (and the dirty reset on success) happens in
      // `agent-navigation` via `markSaved`/`overrideConfig`.
      markSaving: setIsSaving,
      markSaved,
      overrideConfig,
    }),
    [
      agentName,
      config,
      savedConfig,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      setIsSaving,
      markSaved,
      overrideConfig,
    ],
  );

  return (
    <AgentConfigContext.Provider value={value}>
      {children}
    </AgentConfigContext.Provider>
  );
}
