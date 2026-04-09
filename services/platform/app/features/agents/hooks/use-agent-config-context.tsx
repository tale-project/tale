'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  markSaved: () => void;
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
  const [config, setConfig] = useState(initialConfig);
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;

  // Sync with external changes (SSE file events) when user has no unsaved edits
  const savedConfigRef = useRef(savedConfig);
  savedConfigRef.current = savedConfig;
  useEffect(() => {
    const hasUnsavedEdits =
      JSON.stringify(configRef.current) !==
      JSON.stringify(savedConfigRef.current);
    if (!hasUnsavedEdits) {
      setConfig(initialConfig);
      setSavedConfig(initialConfig);
    }
  }, [initialConfig]);

  const isDirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );

  const updateConfig = useCallback((partial: Partial<AgentJsonConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetConfig = useCallback(() => {
    setSavedConfig((prev) => {
      setConfig(prev);
      return prev;
    });
  }, []);

  const markSaving = useCallback((saving: boolean) => {
    setIsSaving(saving);
  }, []);

  const markSaved = useCallback(() => {
    setSavedConfig(configRef.current);
  }, []);

  const overrideConfig = useCallback((next: AgentJsonConfig) => {
    setConfig(next);
    setSavedConfig(next);
  }, []);

  const value = useMemo<AgentConfigContextValue>(
    () => ({
      agentName,
      config,
      initialConfig: savedConfig,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      markSaving,
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
      markSaving,
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
