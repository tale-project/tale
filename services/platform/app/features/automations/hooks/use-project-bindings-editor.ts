'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  type EditorController,
  useRegisterDirtySource,
} from '@/app/components/ui/editor';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useT } from '@/lib/i18n/client';

import {
  useAutomationBindings,
  useAutomationInstallActions,
} from './use-install-state';

export interface ProjectBindingsEditor {
  /** Editor controller — compose it with the Configuration form's so the tab
   *  strip's single Save/Discard commits both at once. */
  controller: EditorController;
  /** MultiSelect options — every project in the org. */
  options: Array<{ value: string; label: string }>;
  /** The current (draft-or-persisted) selected project ids. */
  selection: string[];
  /** Stage a new selection — does NOT persist until the editor saves. */
  setSelection: (next: string[]) => void;
  /** False when the org has no projects to bind. */
  hasProjects: boolean;
}

const DIRTY_KEYS = new Set(['projectBindings']);
const CLEAN_KEYS = new Set<string>();

/**
 * Editor controller for a project-scoped automation's project bindings. The
 * selection is a LOCAL DRAFT diffed against the persisted bindings on save:
 * additions are installed, removals dropped (reversible; org resources are
 * never torn down). A partial failure leaves the reactive bindings as the
 * source of truth, so the remaining diff stays staged and the tab strip keeps
 * the section dirty.
 */
export function useProjectBindingsEditor(
  organizationId: string,
  automationSlug: string,
): ProjectBindingsEditor {
  const { t } = useT('automations');
  const { bindings } = useAutomationBindings(organizationId, automationSlug);
  const { projects } = useProjects(organizationId);
  const { install, removeFromProject } =
    useAutomationInstallActions(organizationId);

  const boundIds = useMemo(() => bindings.map((b) => b.projectId), [bindings]);
  const boundSet = useMemo(() => new Set(boundIds), [boundIds]);

  // `null` = untouched, so the control follows the live server bindings; a
  // non-null draft pins the operator's staged edit until Save or Discard.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selection = draft ?? boundIds;

  const isDirty =
    draft !== null &&
    (draft.length !== boundIds.length || draft.some((id) => !boundSet.has(id)));

  useRegisterDirtySource(isDirty);

  // `save`/`reset` are handed to the tab strip through `useComposedEditor`,
  // which can hold a controller a render stale — read the latest draft/bindings
  // through refs so a click always diffs the current state.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const boundIdsRef = useRef(boundIds);
  boundIdsRef.current = boundIds;

  const options = useMemo(
    () => projects.map((p) => ({ value: p._id, label: p.name })),
    [projects],
  );

  const save = useCallback(async () => {
    const currentDraft = draftRef.current;
    if (currentDraft === null) return;
    setIsSaving(true);
    try {
      const currentBound = boundIdsRef.current;
      const currentBoundSet = new Set(currentBound);
      const draftSet = new Set(currentDraft);
      const toAdd = currentDraft.filter((id) => !currentBoundSet.has(id));
      const toRemove = currentBound.filter((id) => !draftSet.has(id));
      const results = await Promise.allSettled([
        ...toAdd.map((id) => install(automationSlug, id)),
        ...toRemove.map((id) => removeFromProject(automationSlug, id)),
      ]);
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        for (const f of failed) console.error(f.reason);
        // Throw so the tab strip surfaces the failure and keeps the section
        // dirty; the reactive bindings already reflect whatever committed.
        throw new Error(t('membership.saveFailed'));
      }
      setDraft(null);
    } finally {
      setIsSaving(false);
    }
  }, [install, removeFromProject, automationSlug, t]);

  const reset = useCallback(() => setDraft(null), []);

  const controller = useMemo<EditorController>(
    () => ({
      isDirty,
      isSaving,
      isValid: true,
      isLoading: false,
      dirtyKeys: isDirty ? DIRTY_KEYS : CLEAN_KEYS,
      save,
      reset,
    }),
    [isDirty, isSaving, save, reset],
  );

  return {
    controller,
    options,
    selection,
    setSelection: setDraft,
    hasProjects: projects.length > 0,
  };
}
