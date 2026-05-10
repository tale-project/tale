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

import { useSaveProvider } from './mutations';

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
  saveConfig: (partial?: Partial<ProviderJson>) => Promise<void>;
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
  /**
   * Active organization slug. Required so saveConfig writes to the caller's
   * org rather than a hardcoded `'default'` (which fails with
   * `ORG_NOT_FOUND` / `ORG_FORBIDDEN` outside the default-org deployment).
   */
  orgSlug: string;
  providerName: string;
  initialConfig: ProviderJson;
  /**
   * Hash of `initialConfig` as returned by `readProvider` / `saveProvider`.
   * When present, every `saveConfig` round-trips it as `expectedHash` so
   * concurrent edits from another operator surface as a
   * `PROVIDER_VERSION_CONFLICT` toast instead of a silent overwrite.
   */
  initialHash?: string;
  children: React.ReactNode;
}

export function ProviderConfigProvider({
  orgSlug,
  providerName,
  initialConfig,
  initialHash,
  children,
}: ProviderConfigProviderProps) {
  const [config, setConfig] = useState(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  const initialRef = useRef(initialConfig);
  const configRef = useRef(config);
  const hashRef = useRef(initialHash);
  configRef.current = config;

  useEffect(() => {
    const hasUnsavedEdits =
      JSON.stringify(configRef.current) !== JSON.stringify(initialRef.current);
    if (!hasUnsavedEdits) {
      setConfig(initialConfig);
      initialRef.current = initialConfig;
      // Refresh the optimistic-concurrency token alongside the config.
      // Without this, a sibling mutation (saveSecret) or SSE-driven refetch
      // gives us a fresh hash on the read query but `hashRef` keeps the
      // stale one — the next save then trips a spurious
      // `PROVIDER_VERSION_CONFLICT` against ourselves.
      hashRef.current = initialHash;
    }
  }, [initialConfig, initialHash]);

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

  const saveProvider = useSaveProvider();

  const saveConfig = useCallback(
    async (partial?: Partial<ProviderJson>) => {
      const toSave = partial
        ? { ...configRef.current, ...partial }
        : configRef.current;
      if (partial) {
        setConfig(toSave);
      }
      setIsSaving(true);
      try {
        const result = await saveProvider.mutateAsync({
          orgSlug,
          providerName,
          config: toSave,
          ...(hashRef.current ? { expectedHash: hashRef.current } : {}),
        });
        initialRef.current = toSave;
        hashRef.current = result.hash;
      } finally {
        setIsSaving(false);
      }
    },
    [orgSlug, providerName, saveProvider],
  );

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
      saveConfig,
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
      saveConfig,
    ],
  );

  return (
    <ProviderConfigContext.Provider value={value}>
      {children}
    </ProviderConfigContext.Provider>
  );
}
