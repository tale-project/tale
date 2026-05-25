'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';

import type { EditorController } from './types';
import { useRegisterDirtySource } from './use-dirty-source';

// `zodResolver` is generic over `<unknown, FieldValues>`; we widen it back to
// `Resolver<T>` here so callers' typed schemas line up with `useForm<T>` even
// though the underlying validation is identical.
// oxlint-disable-next-line @typescript-eslint/no-explicit-any -- bridge cast
type AnyZodSchema = any;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // Cyclic or non-serializable input — fall back to identity comparison
    // by stamping a non-equivalent string each call so the effect runs.
    return `__nonserializable__:${Math.random()}`;
  }
}

interface UseFormEditorArgs<T extends FieldValues> {
  /**
   * Server-authoritative form data. Undefined while loading; the hook
   * resets the form once data arrives. Subsequent upstream changes are
   * silently absorbed when the form is clean and surface
   * `hasRemoteUpdate: true` when dirty (the user has live edits we don't
   * want to clobber — the Convex baseline-drift fix).
   */
  data: T | undefined;
  /** Optional Zod schema; when present, drives validation + `isValid`. */
  schema?: AnyZodSchema;
  /** Persists the form values. Throw to keep `isDirty` true. */
  save: (values: T) => Promise<void>;
  /**
   * Map an arbitrary server error into per-field issues. When provided
   * and returns issues, `EditorActions` skips the destructive toast and
   * the issues flow through `form.setError` instead.
   */
  mapServerError?: (
    err: unknown,
  ) => ReadonlyArray<{ path: string; message: string }> | null;
}

interface FormEditor<T extends FieldValues> extends EditorController {
  form: UseFormReturn<T>;
  hasRemoteUpdate: boolean;
  /** Dismisses the remote-update indicator until the next upstream change. */
  dismissRemoteUpdate: () => void;
}

/**
 * Adapter over react-hook-form that exposes the unified `EditorController`
 * contract. Use for forms whose schema fits RHF's flat-path model cleanly.
 * For nested JSON blobs that fight RHF array handling, use
 * `useJsonConfigEditor` instead.
 */
export function useFormEditor<T extends FieldValues>({
  data,
  schema,
  save,
  mapServerError,
}: UseFormEditorArgs<T>): FormEditor<T> {
  const form = useForm<T>({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- T extends FieldValues
    defaultValues: data as DefaultValues<T> | undefined,
    resolver: schema
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- zodResolver returns Resolver<unknown,…>; widen
        (zodResolver(schema) as unknown as Resolver<T>)
      : undefined,
    mode: 'onChange',
  });

  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);
  const isSavingRef = useRef(false);
  const inFlightRef = useRef(false);
  // `data` is undefined during the initial load. RHF's `isDirty` reports
  // true in that window (it compares the empty inputs to undefined
  // defaults), so we can't trust it to decide "the user has live edits"
  // until we've reset the form to real data at least once. This ref
  // gates the remote-update branch below.
  const hasInitializedRef = useRef(false);
  // Value-equivalent baseline tracker. Without this we'd `form.reset(data)`
  // every render where a parent rebuilds `data` by reference (test mocks
  // that return `{ ... }` per call, hooks whose deps are themselves
  // unstable). Each reset re-renders, which fires the effect again — an
  // infinite loop. Comparing the structural fingerprint dodges that.
  const lastDataKeyRef = useRef<string | null>(null);
  const dataKey = useMemo(
    () => (data === undefined ? null : safeStringify(data)),
    [data],
  );

  // Convex-baseline drift fix: when upstream data changes, only reset the
  // form if the user has no live edits. Otherwise flag it so the page can
  // offer a "View remote changes" affordance instead of silently clobbering
  // the user's work.
  useEffect(() => {
    if (data === undefined) return;
    if (isSavingRef.current) return;
    if (lastDataKeyRef.current === dataKey) return;
    if (hasInitializedRef.current && form.formState.isDirty) {
      setHasRemoteUpdate(true);
    } else {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- DefaultValues<T> ⊂ T
      form.reset(data as DefaultValues<T>);
      hasInitializedRef.current = true;
      lastDataKeyRef.current = dataKey;
      setHasRemoteUpdate(false);
    }
    // form is stable across renders; intentionally exclude.
  }, [data, dataKey, form]);

  const dismissRemoteUpdate = useCallback(() => {
    setHasRemoteUpdate(false);
  }, []);

  // Suppress dirty while `data` is still undefined — RHF compares empty
  // input values against `defaultValues: undefined` during the loading
  // phase and yields `isDirty: true` for fields the user never touched.
  // The blocker would otherwise latch onto that false positive and fire
  // the "Unsaved changes" dialog on the next navigation.
  const isDirty = data !== undefined && form.formState.isDirty;

  const dirtyKeys = useMemo<ReadonlySet<string>>(() => {
    if (data === undefined) return new Set<string>();
    return new Set(Object.keys(form.formState.dirtyFields));
  }, [data, form.formState.dirtyFields]);

  useRegisterDirtySource(isDirty);

  const doSave = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    isSavingRef.current = true;
    try {
      await new Promise<void>((resolve, reject) => {
        void form.handleSubmit(
          async (values) => {
            try {
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RHF widens generic
              await save(values as unknown as T);
              // Adopt the just-saved values as the new baseline so
              // `isDirty` flips false immediately. `keepValues: true`
              // preserves any subsequent typing after Convex emits the
              // reactive refetch.
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- DefaultValues<T> ⊂ T
              form.reset(values as DefaultValues<T>, {
                keepValues: true,
                keepDirty: false,
              });
              setHasRemoteUpdate(false);
              resolve();
            } catch (err) {
              const issues = mapServerError?.(err) ?? null;
              if (issues && issues.length > 0) {
                for (const { path, message } of issues) {
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caller-provided path string
                  form.setError(path as Path<T>, { type: 'server', message });
                }
                // Resolve so EditorActions doesn't also surface the toast;
                // inline errors are now the only feedback.
                resolve();
              } else {
                reject(err);
              }
            }
          },
          () => {
            reject(new Error('VALIDATION_FAILED'));
          },
        )();
      });
    } finally {
      isSavingRef.current = false;
      inFlightRef.current = false;
    }
  }, [form, save, mapServerError]);

  const reset = useCallback(() => {
    if (isSavingRef.current) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- DefaultValues<T> ⊂ T
    form.reset(data as DefaultValues<T>);
    setHasRemoteUpdate(false);
  }, [form, data]);

  const setServerErrors = useCallback(
    (issues: ReadonlyArray<{ path: string; message: string }>) => {
      for (const { path, message } of issues) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caller-provided path
        form.setError(path as Path<T>, { type: 'server', message });
      }
    },
    [form],
  );

  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RHF widens generic
    form: form as unknown as UseFormReturn<T>,
    hasRemoteUpdate,
    dismissRemoteUpdate,
    isDirty,
    isSaving: form.formState.isSubmitting,
    isValid: schema ? form.formState.isValid : true,
    isLoading: data === undefined,
    dirtyKeys,
    save: doSave,
    reset,
    setServerErrors,
  };
}
