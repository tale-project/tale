'use client';

import { useCallback, useRef } from 'react';

import type { EditorController } from './types';

/**
 * Merge several editors into one controller for a surface that hosts a single
 * Save/Discard cluster over independent editable sections (e.g. the automation
 * Configuration form plus its project-bindings picker). Dirty / saving /
 * loading are OR-ed, validity AND-ed, and `dirtyKeys` unioned.
 *
 * `save()` / `reset()` read the sub-editors through a ref, never a render
 * snapshot: the active-editor registry only re-registers when the four status
 * booleans change, so the controller object the tab strip holds can lag a
 * render behind. Reading the latest sub-editors keeps `save()` from skipping a
 * section that just went dirty (or hitting a section that just went clean).
 */
export function useComposedEditor(
  ...editors: ReadonlyArray<EditorController | null | undefined>
): EditorController {
  const active = editors.filter((e): e is EditorController => e != null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const save = useCallback(async () => {
    // Sequential so a throw short-circuits and the remaining (unsaved)
    // sections keep their dirty state for a retry.
    for (const editor of activeRef.current) {
      if (editor.isDirty) await editor.save();
    }
  }, []);

  const reset = useCallback(() => {
    for (const editor of activeRef.current) editor.reset();
  }, []);

  const dirtyKeys = new Set<string>();
  for (const editor of active)
    for (const key of editor.dirtyKeys) dirtyKeys.add(key);

  return {
    isDirty: active.some((e) => e.isDirty),
    isSaving: active.some((e) => e.isSaving),
    isValid: active.every((e) => e.isValid),
    isLoading: active.some((e) => e.isLoading),
    dirtyKeys,
    save,
    reset,
  };
}
