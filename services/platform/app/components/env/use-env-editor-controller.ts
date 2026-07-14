'use client';

import { useCallback, useMemo, useState } from 'react';

import type { EditorController } from '@/app/components/ui/editor/types';

import type { EnvEditorState } from './env-var-list-editor';

const EMPTY_KEYS: ReadonlySet<string> = new Set();

/**
 * Bridges `EnvVarListEditor`'s external-save state (`onEditorState`) to the
 * unified `EditorController` contract, so env surfaces dock Save/Discard in
 * the same header cluster as every other editor — register the returned
 * controller via `useRegisterActiveEditor`, or compose it with a form editor
 * (`composeEditors`) on pages that host both.
 *
 * `dirtyKey` is the top-level key reported in `dirtyKeys` while dirty — tab
 * shells intersect it with a tab's declared keys to render the per-tab dot.
 */
export function useEnvEditorController(dirtyKey = 'environment'): {
  controller: EditorController;
  onEditorState: (state: EnvEditorState) => void;
} {
  const [state, setState] = useState<EnvEditorState | null>(null);

  const controller = useMemo<EditorController>(
    () => ({
      isDirty: state?.isDirty ?? false,
      isSaving: state?.isSaving ?? false,
      isValid: true,
      // No report yet = the editor hasn't mounted/loaded — keep Save disabled.
      isLoading: state?.isLoading ?? true,
      dirtyKeys: state?.isDirty ? new Set([dirtyKey]) : EMPTY_KEYS,
      save: async () => {
        await state?.save();
      },
      reset: () => {
        state?.reset();
      },
    }),
    [state, dirtyKey],
  );

  const onEditorState = useCallback(
    (next: EnvEditorState) => setState(next),
    [],
  );

  return { controller, onEditorState };
}
