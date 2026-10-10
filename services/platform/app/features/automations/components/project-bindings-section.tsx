'use client';

import { Badge } from '@tale/ui/badge';
import {
  useRegisterDirtySource,
  useRegisterGroupedEditor,
  type EditorController,
} from '@tale/ui/editor';
import { MultiSelect } from '@tale/ui/multi-select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';

import { useSetAutomationProjects } from '../hooks/mutations';
import { useAutomationProjects } from '../hooks/queries';
import { PROJECTS_DIRTY_KEY } from '../lib/dirty-keys';
import { automationErrorMessage } from '../lib/errors';
import { AUTOMATION_PROJECTS_FIELD_ID } from '../lib/field-ids';

const NO_DIRTY_KEYS: ReadonlySet<string> = new Set();
/** What the General tab's strip lights its unsaved dot for. */
const PROJECTS_DIRTY_KEYS: ReadonlySet<string> = new Set([PROJECTS_DIRTY_KEY]);

function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * `incoming` with the author's unsaved edits replayed on it: a project they
 * picked or dropped — since `loaded`, or since the save in flight sent
 * `sent` — keeps their choice, and every other project follows `incoming`.
 */
function keepEdits(
  loaded: readonly string[],
  current: readonly string[],
  incoming: readonly string[],
  sent: readonly string[] = loaded,
): string[] {
  const edited = (id: string): boolean =>
    current.includes(id) !== loaded.includes(id) ||
    current.includes(id) !== sent.includes(id);
  return [
    ...incoming.filter((id) => !edited(id) || current.includes(id)),
    ...current.filter((id) => edited(id) && !incoming.includes(id)),
  ];
}

/**
 * The automation's project bindings: which projects' task boards see it.
 *
 * The binding SET is the scope — none means the automation is org-level and
 * every project's board sees it, one or more means exactly those projects —
 * so the section edits the whole selection and saves it in one reconcile
 * (`setAutomationProjects`), the same one-row-of-truth shape as the trigger.
 * Deleting a project refuses while an automation is bound to it, so removals
 * happen here first, deliberately.
 *
 * A section of the automation's General tab: its edits join the page's one
 * Save/Discard cluster in the tab strip, and leaving the tab with an unsaved
 * selection asks first.
 */
export function ProjectBindingsSection({
  organizationId,
  name,
  /** Authoring is developer-gated server-side; readers still see the set. */
  canEdit,
}: {
  organizationId: string;
  name: string;
  canEdit: boolean;
}) {
  const { t } = useT('automations');

  const boundQuery = useAutomationProjects(organizationId, name);
  const { projects } = useProjects(organizationId);
  const setProjects = useSetAutomationProjects();

  const stored = useMemo(
    () => (boundQuery.data ?? []).map(String),
    [boundQuery.data],
  );
  const [selection, setSelection] = useState<string[]>([]);

  // The rows are the truth; local state only carries unsaved edits, which a
  // set another session saved does not erase: they are replayed on it. Keyed
  // on the set's content, not on the array, so a refetch that answers the
  // same set loads nothing; and the functional update returns the CURRENT
  // array when the content already matches, so React bails out of the
  // re-render.
  const storedRef = useRef(stored);
  storedRef.current = stored;
  // The set the selection last loaded (or saved), and while a save is out
  // the set it sent: what tells the author's edits apart.
  const loadedRef = useRef<readonly string[]>([]);
  const sentRef = useRef<readonly string[] | null>(null);
  const storedKey = stored.join(',');
  useEffect(() => {
    const next = storedRef.current;
    const loaded = loadedRef.current;
    const sent = sentRef.current ?? loaded;
    loadedRef.current = next;
    // A project the save in flight left as loaded follows the set from now
    // on, as the selection does.
    if (sentRef.current !== null) {
      sentRef.current = keepEdits(loaded, sentRef.current, next);
    }
    setSelection((current) => {
      const rebased = keepEdits(loaded, current, next, sent);
      return sameSelection(current, rebased) ? current : rebased;
    });
  }, [storedKey]);

  const dirty = useMemo(() => {
    if (selection.length !== stored.length) return true;
    const current = new Set(stored);
    return selection.some((projectId) => !current.has(projectId));
  }, [selection, stored]);

  const options = projects.map((project) => ({
    value: project._id,
    label: project.name,
  }));

  /** Write the selection as the automation's binding set. */
  const persist = async (): Promise<void> => {
    sentRef.current = selection;
    try {
      await setProjects.mutateAsync({
        organizationId,
        name,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every value came from the projects listing
        projectIds: selection,
      });
      // The store holds the selection as sent: a project still as sent
      // follows the set it answers with, while one changed during the save
      // keeps the change.
      loadedRef.current = sentRef.current ?? selection;
    } catch (error) {
      // The store's refusal names the problem and the fix; the cluster
      // raises it as the save's one failure toast.
      throw new Error(automationErrorMessage(error), { cause: error });
    } finally {
      sentRef.current = null;
    }
  };

  // The group keeps the controller it registered until one of its status
  // flags changes, so save and discard read the latest selection through
  // refs.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const controller = useMemo<EditorController>(
    () => ({
      isDirty: dirty,
      isSaving: setProjects.isPending,
      isValid: true,
      isLoading: boundQuery.isPending,
      dirtyKeys: dirty ? PROJECTS_DIRTY_KEYS : NO_DIRTY_KEYS,
      save: () => persistRef.current(),
      reset: () => {
        setSelection(storedRef.current);
      },
    }),
    [dirty, setProjects.isPending, boundQuery.isPending],
  );
  useRegisterGroupedEditor(controller, { enabled: canEdit });
  // The draft lives in this section only, so leaving the tab would drop it.
  useRegisterDirtySource(canEdit && dirty);

  return (
    <Skeletonize loading={boundQuery.isPending} label={t('bindings.title')}>
      <SettingsSection
        title={t('bindings.title')}
        description={t('bindings.hint')}
        {...(stored.length > 0 && {
          action: (
            <Badge variant="blue">
              {t('bindings.countBadge', { count: stored.length })}
            </Badge>
          ),
        })}
      >
        {options.length === 0 ? (
          <Text as="p" variant="muted" className="text-sm italic">
            {t('bindings.noProjects')}
          </Text>
        ) : (
          <MultiSelect
            id={AUTOMATION_PROJECTS_FIELD_ID}
            value={selection}
            onValueChange={setSelection}
            options={options}
            placeholder={t('bindings.placeholder')}
            searchPlaceholder={t('bindings.searchPlaceholder')}
            emptyText={t('bindings.empty')}
            aria-label={t('bindings.title')}
            disabled={!canEdit}
            // Bound sets can be long; keep the section's height honest and
            // surface overflow with a scroll cue.
            chipsMaxHeightClassName="max-h-40"
          />
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
