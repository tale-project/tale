'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';

interface AgentConfigContextValue {
  agentName: string;
  config: AgentJsonConfig;
  initialConfig: AgentJsonConfig;
  isDirty: boolean;
  isSaving: boolean;
  updateConfig: (partial: Partial<AgentJsonConfig>) => void;
  resetConfig: () => void;
  markSaving: (saving: boolean) => void;
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
  const [config, setConfig] = useState<AgentJsonConfig>(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  const initialRef = useRef(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;

  const isDirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialRef.current),
    [config],
  );

  const updateConfig = useCallback((partial: Partial<AgentJsonConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(initialRef.current);
  }, []);

  const markSaving = useCallback((saving: boolean) => {
    setIsSaving(saving);
    if (!saving) {
      initialRef.current = configRef.current;
    }
  }, []);

  const value = useMemo<AgentConfigContextValue>(
    () => ({
      agentName,
      config,
      initialConfig: initialRef.current,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      markSaving,
    }),
    [
      agentName,
      config,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      markSaving,
    ],
  );

  return (
    <AgentConfigContext.Provider value={value}>
      {children}
    </AgentConfigContext.Provider>
  );
}
