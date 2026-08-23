'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { changedKeys, structuralEqual } from '@/lib/utils/structural-equal';

import type { EditorController } from './types';
import { useRegisterDirtySource } from './use-dirty-source';

/**
 * Minimal shape `useJsonConfigEditor` needs from a validator — any Zod
 * schema satisfies this without importing `zod` into this generic UI
 * primitive. Mirrors `useFormEditor`'s optional `schema`, generalized to
 * `safeParse` since a JSON-config editor has no RHF form to bind a resolver
 * to.
 */
export interface JsonConfigSchema<T> {
  safeParse: (value: T) => { success: boolean };
}

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
  /** Structural compare. Defaults to {@link structuralEqual}. */
  equals?: (a: T, b: T) => boolean;
  /**
   * Best-effort history snapshot. Runs **after** the save succeeds with the
   * prior baseline as input — fixes the snapshot-then-save ordering bug in
   * the legacy agent flow where a failed save left a no-op snapshot.
   */
  snapshotPriorBaseline?: (priorBaseline: T) => Promise<void>;
  /**
   * Optional schema; when present, drives `isValid` (the same server-parity
   * contract as `useFormEditor`'s `schema`) so Save can't submit a config the
   * server would reject. Absent = always valid, the pre-existing behavior for
   * callers with no schema-shaped invalidity (e.g. the project agents/models
   * tab) (#2665).
   */
  schema?: JsonConfigSchema<T>;
}

interface JsonConfigEditor<T> extends EditorController {
  config: T | undefined;
  savedConfig: T | undefined;
  updateConfig: (partial: Partial<T>) => void;
  overrideConfig: (next: T) => void;
  markSaved: (persisted: T) => void;
}

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
  equals = structuralEqual,
  snapshotPriorBaseline,
  schema,
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
  // Latest closures behind stable refs so `save` keeps a stable identity for
  // the active-editor registry (see the same pattern in `useFormEditor`).
  const saveRef = useRef(save);
  saveRef.current = save;
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;
  const snapshotRef = useRef(snapshotPriorBaseline);
  snapshotRef.current = snapshotPriorBaseline;

  // Sync external updates: when the parent re-fetches and the user has no
  // unsaved edits, silently advance both working copy and baseline. When
  // dirty, leave the working copy alone — clobbering live edits is the
  // exact data-loss path we're fixing. The `equals(saved, initial)` guard
  // makes a parent that rebuilds `initial` by reference each render (same
  // content) a no-op instead of an infinite `setConfig → re-render → effect`
  // loop.
  useEffect(() => {
    if (initial === undefined) return;
    const hasUnsavedEdits =
      configRef.current !== undefined &&
      savedRef.current !== undefined &&
      !equals(configRef.current, savedRef.current);
    if (hasUnsavedEdits) return;
    if (savedRef.current !== undefined && equals(savedRef.current, initial)) {
      return;
    }
    setConfig(initial);
    setSavedConfig(initial);
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
    // oxlint-disable typescript/no-unsafe-type-assertion -- record reflection
    const cfgRec = config as unknown as Record<string, unknown>;
    const savedRec = savedConfig as unknown as Record<string, unknown>;
    // oxlint-enable typescript/no-unsafe-type-assertion
    return changedKeys(cfgRec, savedRec);
  }, [config, savedConfig, isDirty]);

  const updateConfig = useCallback((partial: Partial<T>) => {
    setConfig((prev) => (prev === undefined ? prev : { ...prev, ...partial }));
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
      const result = await saveRef.current(configRef.current);
      const normalizeFn = normalizeRef.current;
      const next = normalizeFn
        ? normalizeFn(result ?? configRef.current)
        : (result ?? configRef.current);
      setConfig(next);
      setSavedConfig(next);
      const snapshotFn = snapshotRef.current;
      if (snapshotFn && priorBaseline !== undefined) {
        snapshotFn(priorBaseline).catch((err) => {
          // History snapshots are best-effort; log but don't fail save.
          console.warn('[editor] history snapshot failed', err);
        });
      }
    } finally {
      setIsSaving(false);
      inFlightRef.current = false;
    }
  }, []);

  // No schema = always valid, the pre-existing behavior. With a schema, this
  // mirrors `useFormEditor`'s `schema`-driven `isValid` — the config is still
  // `undefined` while loading, which reads as valid (there is nothing to
  // reject yet; `isLoading`/`isDirty` already gate Save in that window).
  const isValid = useMemo(() => {
    if (!schema) return true;
    if (config === undefined) return true;
    return schema.safeParse(config).success;
  }, [schema, config]);

  // Register with the page-level DirtyBlockerProvider so navigation away
  // prompts before discarding unsaved edits.
  useRegisterDirtySource(isDirty);

  return {
    config,
    savedConfig,
    isDirty,
    isSaving,
    isValid,
    isLoading: initial === undefined,
    dirtyKeys,
    save: doSave,
    reset,
    updateConfig,
    overrideConfig,
    markSaved,
  };
}
