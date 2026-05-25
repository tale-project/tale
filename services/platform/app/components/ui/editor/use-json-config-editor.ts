'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EditorController } from './types';
import { useRegisterDirtySource } from './use-dirty-source';

interface UseJsonConfigEditorArgs<T> {
  /**
   * Server-authoritative initial value. `undefined` while loading; the
   * editor reports `isLoading: true` until it resolves and switches the
   * working copy + baseline atomically.
   */
  initial: T | undefined;
  /** Persists the working copy. Throw on failure to keep `isDirty` true. */
  save: (config: T) => Promise<T | void>;
  /**
   * Optional client-side projection of the saved value so the baseline
   * matches whatever the server is going to normalize back to disk. Mirrors
   * `normalizeAgentConfig` in the agent flow.
   */
  normalize?: (config: T) => T;
  /** Structural compare. Defaults to JSON.stringify. */
  equals?: (a: T, b: T) => boolean;
  /**
   * Best-effort history snapshot. Runs **after** the save succeeds with the
   * prior baseline as input — fixes the snapshot-then-save ordering bug in
   * the legacy agent flow where a failed save left a no-op snapshot.
   */
  snapshotPriorBaseline?: (priorBaseline: T) => Promise<void>;
}

interface JsonConfigEditor<T> extends EditorController {
  config: T | undefined;
  savedConfig: T | undefined;
  updateConfig: (partial: Partial<T>) => void;
  overrideConfig: (next: T) => void;
  markSaved: (persisted: T) => void;
}

const defaultEquals = <T>(a: T, b: T) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Imperative editor for nested JSON configs that don't fit react-hook-form
 * cleanly (agent tools, workflow steps, provider options). Wraps the
 * agent/workflow contexts' "config + savedConfig + isDirty" pattern in a
 * single hook so every consumer gets the same `EditorController` shape.
 */
export function useJsonConfigEditor<T>({
  initial,
  save,
  normalize,
  equals = defaultEquals,
  snapshotPriorBaseline,
}: UseJsonConfigEditorArgs<T>): JsonConfigEditor<T> {
  const [config, setConfig] = useState(initial);
  const [savedConfig, setSavedConfig] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const inFlightRef = useRef(false);
  const savedRef = useRef(savedConfig);
  savedRef.current = savedConfig;
  const configRef = useRef(config);
  configRef.current = config;
  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;

  // Sync external updates: when the parent re-fetches and the user has no
  // unsaved edits, silently advance both working copy and baseline. When
  // dirty, leave the working copy alone — clobbering live edits is the
  // exact data-loss path we're fixing.
  useEffect(() => {
    if (initial === undefined) return;
    const hasUnsavedEdits =
      configRef.current !== undefined &&
      savedRef.current !== undefined &&
      !equals(configRef.current, savedRef.current);
    if (!hasUnsavedEdits) {
      setConfig(initial);
      setSavedConfig(initial);
    }
  }, [initial, equals]);

  const isDirty = useMemo(() => {
    if (config === undefined || savedConfig === undefined) return false;
    return !equals(config, savedConfig);
  }, [config, savedConfig, equals]);

  const dirtyKeys = useMemo<ReadonlySet<string>>(() => {
    if (config === undefined || savedConfig === undefined || !isDirty) {
      return new Set<string>();
    }
    if (
      typeof config !== 'object' ||
      typeof savedConfig !== 'object' ||
      config === null ||
      savedConfig === null
    ) {
      return new Set<string>(['root']);
    }
    const keys = new Set<string>();
    // oxlint-disable typescript/no-unsafe-type-assertion -- record reflection
    const cfgRec = config as unknown as Record<string, unknown>;
    const savedRec = savedConfig as unknown as Record<string, unknown>;
    // oxlint-enable typescript/no-unsafe-type-assertion
    const allKeys = new Set([...Object.keys(cfgRec), ...Object.keys(savedRec)]);
    for (const k of allKeys) {
      if (JSON.stringify(cfgRec[k]) !== JSON.stringify(savedRec[k])) {
        keys.add(k);
      }
    }
    return keys;
  }, [config, savedConfig, isDirty]);

  useRegisterDirtySource(isDirty);

  const updateConfig = useCallback((partial: Partial<T>) => {
    setConfig((prev) =>
      prev === undefined ? prev : ({ ...prev, ...partial } as T),
    );
  }, []);

  const overrideConfig = useCallback((next: T) => {
    setConfig(next);
    setSavedConfig(next);
  }, []);

  const markSaved = useCallback((persisted: T) => {
    setSavedConfig(persisted);
  }, []);

  const reset = useCallback(() => {
    if (isSavingRef.current) return;
    if (savedRef.current !== undefined) {
      setConfig(savedRef.current);
    }
  }, []);

  const doSave = useCallback(async () => {
    if (inFlightRef.current) return;
    if (configRef.current === undefined) return;
    inFlightRef.current = true;
    setIsSaving(true);
    const priorBaseline = savedRef.current;
    try {
      const result = await save(configRef.current);
      const next = normalize
        ? normalize(result ?? configRef.current)
        : (result ?? configRef.current);
      setConfig(next);
      setSavedConfig(next);
      if (snapshotPriorBaseline && priorBaseline !== undefined) {
        snapshotPriorBaseline(priorBaseline).catch((err) => {
          // History snapshots are best-effort; log but don't fail save.
          console.warn('[editor] history snapshot failed', err);
        });
      }
    } finally {
      setIsSaving(false);
      inFlightRef.current = false;
    }
  }, [save, normalize, snapshotPriorBaseline]);

  return {
    config,
    savedConfig,
    isDirty,
    isSaving,
    isValid: true,
    isLoading: initial === undefined,
    dirtyKeys,
    save: doSave,
    reset,
    updateConfig,
    overrideConfig,
    markSaved,
  };
}
