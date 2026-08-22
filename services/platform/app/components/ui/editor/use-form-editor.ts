'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';

import { useForm } from '@/app/components/ui/forms/use-form';
import { structuralEqual } from '@/lib/utils/structural-equal';

import { isEditorSaveCancelled, type EditorController } from './types';
import { useRegisterDirtySource } from './use-dirty-source';

// `zodResolver` is generic over `<unknown, FieldValues>`; we widen it back to
// `Resolver<T>` here so callers' typed schemas line up with `useForm<T>` even
// though the underlying validation is identical.
// oxlint-disable-next-line @typescript-eslint/no-explicit-any -- bridge cast
type AnyZodSchema = any;

interface UseFormEditorArgs<T extends FieldValues> {
  /**
   * Server-authoritative form data. Undefined while loading; the hook
   * resets the form once data arrives. Subsequent upstream changes are
   * silently absorbed when the form is clean and surface
   * `hasRemoteUpdate: true` when dirty (the user has live edits we don't
   * want to clobber — the Convex baseline-drift fix).
   */
  data: T | undefined;
  /**
   * Stable, fully-defined initial values for the very first render, before the
   * async `data` resolves. RHF reads `defaultValues` once at mount, so seeding
   * it here keeps controlled inputs (Select/Switch) controlled from the first
   * render instead of mounting with `undefined` and tripping React's
   * uncontrolled→controlled warning when `data` arrives.
   */
  defaultValues?: DefaultValues<T>;
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
  /**
   * Form `onSubmit` handler — wire it as `<form onSubmit={editor.submit}>`.
   * It routes the native submit (Save button `type="submit"`, Enter key)
   * through {@link save}/`doSave`, so the dirty baseline is reset on success.
   *
   * Use this instead of the raw `form.handleSubmit(save)`: that calls `save`
   * directly and never clears `isDirty`, leaving the Save button active and
   * tripping the navigation blocker after a successful save.
   */
  submit: (e?: { preventDefault: () => void }) => void;
}

/**
 * Adapter over react-hook-form that exposes the unified `EditorController`
 * contract. Use for forms whose schema fits RHF's flat-path model cleanly.
 * For nested JSON blobs that fight RHF array handling, use
 * `useJsonConfigEditor` instead.
 */
export function useFormEditor<T extends FieldValues>({
  data,
  defaultValues,
  schema,
  save,
  mapServerError,
}: UseFormEditorArgs<T>): FormEditor<T> {
  const form = useForm<T>({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- T extends FieldValues
    defaultValues: (data ?? defaultValues) as DefaultValues<T> | undefined,
    resolver: schema
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- zodResolver returns Resolver<unknown,…>; widen
        zodResolver(schema)
      : undefined,
    // `mode` defaults to `'onTouched'` via the shared `useForm` wrapper (#1943).
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
  // infinite loop. A structural compare against the last-adopted baseline
  // dodges that AND is key-order-insensitive, so a server payload whose keys
  // arrive in a different order than our local shape doesn't trigger a
  // spurious reset / remote-update flag.
  const lastDataRef = useRef<T | undefined>(undefined);
  // Latest closures behind stable refs. `doSave`/`reset` are handed to the
  // active-editor registry, which only re-registers when isDirty/isSaving/
  // isValid/isLoading change — so if these callbacks changed identity on every
  // `data`/`save`-prop churn, the global Save bar could invoke a stale closure
  // (e.g. discarding to an outdated baseline after a remote update). Reading
  // through refs keeps their identity stable AND always-current.
  const saveRef = useRef(save);
  saveRef.current = save;
  const mapServerErrorRef = useRef(mapServerError);
  mapServerErrorRef.current = mapServerError;
  const dataRef = useRef(data);
  dataRef.current = data;

  // Convex-baseline drift fix: when upstream data changes, only reset the
  // form if the user has no live edits. Otherwise flag it so the page can
  // offer a "View remote changes" affordance instead of silently clobbering
  // the user's work.
  useEffect(() => {
    if (data === undefined) return;
    if (isSavingRef.current) return;
    if (
      lastDataRef.current !== undefined &&
      structuralEqual(lastDataRef.current, data)
    ) {
      return;
    }
    if (hasInitializedRef.current && form.formState.isDirty) {
      setHasRemoteUpdate(true);
    } else {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- DefaultValues<T> ⊂ T
      form.reset(data);
      hasInitializedRef.current = true;
      lastDataRef.current = data;
      setHasRemoteUpdate(false);
    }
    // form is stable across renders; intentionally exclude.
  }, [data, form]);

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
              await saveRef.current(values);
              // Adopt the just-saved values as the new baseline so
              // `isDirty` flips false immediately. `keepValues: true`
              // preserves any subsequent typing after Convex emits the
              // reactive refetch.
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- DefaultValues<T> ⊂ T
              form.reset(values, {
                keepValues: true,
                keepDirty: false,
              });
              setHasRemoteUpdate(false);
              resolve();
            } catch (err) {
              const issues = mapServerErrorRef.current?.(err) ?? null;
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
  }, [form]);

  const isValid = schema ? form.formState.isValid : true;

  // Register with the page-level DirtyBlockerProvider so navigation away
  // prompts before discarding unsaved edits.
  useRegisterDirtySource(isDirty);

  const submit = useCallback(
    (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      // Route the native form submit through `doSave` so the dirty baseline is
      // reset on success. Validation failures surface inline via
      // `form.setError` and a cancelled save is a deliberate no-op, so both
      // stay quiet; a server failure has no cluster to toast it on this path
      // (the native submit bypasses `EditorActions`), so log it rather than
      // swallow it.
      doSave().catch((err) => {
        if (isEditorSaveCancelled(err)) return;
        if (!(err instanceof Error && err.message === 'VALIDATION_FAILED')) {
          console.error('[useFormEditor] submit failed', err);
        }
      });
    },
    [doSave],
  );

  const reset = useCallback(() => {
    if (isSavingRef.current) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- DefaultValues<T> ⊂ T
    form.reset(dataRef.current);
    setHasRemoteUpdate(false);
  }, [form]);

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
    form: form,
    hasRemoteUpdate,
    dismissRemoteUpdate,
    isDirty,
    isSaving: form.formState.isSubmitting,
    isValid,
    isLoading: data === undefined,
    dirtyKeys,
    save: doSave,
    submit,
    reset,
    setServerErrors,
  };
}
