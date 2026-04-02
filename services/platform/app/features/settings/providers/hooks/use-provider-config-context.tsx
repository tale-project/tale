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

import type { ProviderJson } from '@/lib/shared/schemas/providers';

interface ProviderConfigContextValue {
  providerName: string;
  config: ProviderJson;
  initialConfig: ProviderJson;
  isDirty: boolean;
  isSaving: boolean;
  updateConfig: (partial: Partial<ProviderJson>) => void;
  resetConfig: () => void;
  markSaving: (saving: boolean) => void;
  overrideConfig: (config: ProviderJson) => void;
}

const ProviderConfigContext = createContext<ProviderConfigContextValue | null>(
  null,
);

export function useProviderConfig() {
  const ctx = useContext(ProviderConfigContext);
  if (!ctx) {
    throw new Error(
      'useProviderConfig must be used within ProviderConfigProvider',
    );
  }
  return ctx;
}

interface ProviderConfigProviderProps {
  providerName: string;
  initialConfig: ProviderJson;
  children: React.ReactNode;
}

export function ProviderConfigProvider({
  providerName,
  initialConfig,
  children,
}: ProviderConfigProviderProps) {
  const [config, setConfig] = useState<ProviderJson>(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  const initialRef = useRef(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const hasUnsavedEdits =
      JSON.stringify(configRef.current) !== JSON.stringify(initialRef.current);
    if (!hasUnsavedEdits) {
      setConfig(initialConfig);
      initialRef.current = initialConfig;
    }
  }, [initialConfig]);

  const isDirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialRef.current),
    [config],
  );

  const updateConfig = useCallback((partial: Partial<ProviderJson>) => {
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

  const overrideConfig = useCallback((next: ProviderJson) => {
    setConfig(next);
    initialRef.current = next;
  }, []);

  const value = useMemo<ProviderConfigContextValue>(
    () => ({
      providerName,
      config,
      initialConfig: initialRef.current,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      markSaving,
      overrideConfig,
    }),
    [
      providerName,
      config,
      isDirty,
      isSaving,
      updateConfig,
      resetConfig,
      markSaving,
      overrideConfig,
    ],
  );

  return (
    <ProviderConfigContext.Provider value={value}>
      {children}
    </ProviderConfigContext.Provider>
  );
}
