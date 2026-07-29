'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import { structuralEqual } from '@/lib/utils/structural-equal';

interface UseConfigDirtyStateArgs<T> {
  /**
   * Server-authoritative value. May change over the component's life (a
   * refetch / SSE push). While the user has unsaved edits the working copy is
   * left untouched; when clean, both working copy and baseline advance to it.
   */
  initial: T;
  /** Structural compare. Defaults to {@link structuralEqual}. */
  equals?: (a: T, b: T) => boolean;
}

interface ConfigDirtyState<T> {
  /** Working copy the UI edits. */
  config: T;
  /** Last-saved baseline `isDirty` is measured against. */
  savedConfig: T;
  isDirty: boolean;
  isSaving: boolean;
  /** Always-current working copy, for reads inside async save handlers. */
  configRef: MutableRefObject<T>;
  /** Always-current baseline, for reads inside async save handlers. */
  savedConfigRef: MutableRefObject<T>;
  setConfig: Dispatch<SetStateAction<T>>;
  /** Shallow-merge a partial into the working copy (object configs only). The
   *  functional form receives the LATEST working copy, so callers that derive
   *  the partial from current state (e.g. deep-merging a nested field) stay
   *  correct even across rapid successive updates within one render tick. */
  updateConfig: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void;
  /** Revert the working copy to the saved baseline. */
  resetConfig: () => void;
  /** Adopt `next` as BOTH working copy and baseline (post-save / restore). */
  overrideConfig: (next: T) => void;
  /** Advance the baseline only — the working copy already holds saved shape. */
  markSaved: (persisted: T) => void;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
}

/**
 * Shared dirty-state core for the imperative "edit a config object" pattern
 * used by the agent / provider / automation editor contexts. Keeps the baseline
 * in React state (not a ref) so `isDirty` is a pure `useMemo(config,
 * savedConfig)` derivation — a ref baseline reads stale because mutating
 * `ref.current` doesn't re-run the memo, which let "Save" stay enabled after a
 * successful save until an unrelated refetch nudged `config`.
 *
 * Each context layers its own concerns (save orchestration, version hashes,
 * step helpers, telemetry) on top of this core but shares the dirty math so
 * the three can't drift apart again. Equality is {@link structuralEqual}, so
 * server key-order shuffles never read as dirty.
 */
export function useConfigDirtyState<T>({
  initial,
  equals = structuralEqual,
}: UseConfigDirtyStateArgs<T>): ConfigDirtyState<T> {
  const [config, setConfig] = useState(initial);
  const [savedConfig, setSavedConfig] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;
  const savedConfigRef = useRef(savedConfig);
  savedConfigRef.current = savedConfig;
  const equalsRef = useRef(equals);
  equalsRef.current = equals;

  // External-sync: when upstream `initial` changes, only adopt it if the user
  // has no live edits — clobbering unsaved work is the exact data-loss path we
  // refuse. The structural guard also makes a parent that rebuilds `initial`
  // by reference each render (same content) a no-op instead of a reset loop.
  useEffect(() => {
    const eq = equalsRef.current;
    const hasUnsavedEdits = !eq(configRef.current, savedConfigRef.current);
    if (hasUnsavedEdits) return;
    if (eq(savedConfigRef.current, initial)) return;
    setConfig(initial);
    setSavedConfig(initial);
  }, [initial]);

  const isDirty = useMemo(
    () => !equals(config, savedConfig),
    [config, savedConfig, equals],
  );

  const updateConfig = useCallback(
    (partial: Partial<T> | ((prev: T) => Partial<T>)) => {
      setConfig((prev) => {
        if (prev === null || typeof prev !== 'object') return prev;
        const resolved =
          typeof partial === 'function' ? partial(prev) : partial;
        return { ...prev, ...resolved };
      });
    },
    [],
  );

  const resetConfig = useCallback(() => {
    setConfig(savedConfigRef.current);
  }, []);

  const overrideConfig = useCallback((next: T) => {
    setConfig(next);
    setSavedConfig(next);
  }, []);

  const markSaved = useCallback((persisted: T) => {
    setSavedConfig(persisted);
  }, []);

  return {
    config,
    savedConfig,
    isDirty,
    isSaving,
    configRef,
    savedConfigRef,
    setConfig,
    updateConfig,
    resetConfig,
    overrideConfig,
    markSaved,
    setIsSaving,
  };
}
