'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import { useConfigDirtyState } from '@/app/components/ui/editor/use-config-dirty-state';
import type { ProviderJson } from '@/lib/shared/schemas/providers';
import { structuralEqual } from '@/lib/utils/structural-equal';

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
   * Better Auth organization id. Required so saveConfig writes to the
   * caller's org rather than a hardcoded `'default'`.
   */
  organizationId: string;
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
  organizationId,
  providerName,
  initialConfig,
  initialHash,
  children,
}: ProviderConfigProviderProps) {
  const {
    config,
    savedConfig,
    isDirty,
    isSaving,
    configRef,
    savedConfigRef,
    updateConfig,
    resetConfig,
    overrideConfig,
    markSaved,
    setIsSaving,
  } = useConfigDirtyState<ProviderJson>({ initial: initialConfig });

  // Optimistic-concurrency token. Refreshed whenever the upstream hash changes
  // while the user has no live edits — without this a sibling mutation
  // (saveSecret) or SSE refetch leaves `hashRef` stale and the next save trips
  // a spurious `PROVIDER_VERSION_CONFLICT` against ourselves. Gated on clean
  // (not on `isDirty` flipping) so the fresh hash `saveConfig` just stored is
  // never clobbered by a stale prop.
  const hashRef = useRef(initialHash);
  useEffect(() => {
    if (!structuralEqual(configRef.current, savedConfigRef.current)) return;
    hashRef.current = initialHash;
  }, [initialHash, configRef, savedConfigRef]);

  const markSaving = useCallback(
    (saving: boolean) => {
      setIsSaving(saving);
      // Legacy semantics: leaving the in-flight state commits the working copy
      // as the new baseline.
      if (!saving) markSaved(configRef.current);
    },
    [configRef, markSaved, setIsSaving],
  );

  const saveProvider = useSaveProvider();

  const saveConfig = useCallback(
    async (partial?: Partial<ProviderJson>) => {
      const toSave = partial
        ? { ...configRef.current, ...partial }
        : configRef.current;
      setIsSaving(true);
      try {
        const result = await saveProvider.mutateAsync({
          organizationId,
          providerName,
          config: toSave,
          ...(hashRef.current ? { expectedHash: hashRef.current } : {}),
        });
        // Adopt the saved shape as both working copy and baseline so `isDirty`
        // flips false immediately (no dependence on a follow-up refetch).
        overrideConfig(toSave);
        hashRef.current = result.hash;
      } finally {
        setIsSaving(false);
      }
    },
    [
      configRef,
      organizationId,
      overrideConfig,
      providerName,
      saveProvider,
      setIsSaving,
    ],
  );

  const value = useMemo<ProviderConfigContextValue>(
    () => ({
      providerName,
      config,
      initialConfig: savedConfig,
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
      savedConfig,
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
