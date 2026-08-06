'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { useEffect, useId, useMemo, useState } from 'react';

import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { useProjects } from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useSetAutomationProjects } from '../hooks/mutations';
import { useAutomationProjects } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';

/**
 * The automation's project bindings: which projects' task boards see it.
 *
 * The binding SET is the scope — none means the automation is org-level and
 * every project's board sees it, one or more means exactly those projects —
 * so the panel edits the whole selection and saves it in one reconcile
 * (`setAutomationProjects`), the same one-row-of-truth shape as the trigger
 * panel beside it. Deleting a project refuses while an automation is bound to
 * it, so removals happen here first, deliberately.
 *
 * Laid out as a self-contained card so it can sit beside the Trigger panel
 * on wide screens: header, growing body, actions pinned to the bottom.
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
  const headingId = useId();

  const boundQuery = useAutomationProjects(organizationId, name);
  const { projects } = useProjects(organizationId);
  const setProjects = useSetAutomationProjects();

  const stored = useMemo(() => boundQuery.data ?? [], [boundQuery.data]);
  const [selection, setSelection] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  // The rows are the truth; local state only carries unsaved edits. The
  // functional update returns the CURRENT array when the content already
  // matches, so React bails out of the re-render — the sync must not depend
  // on the query data being referentially stable.
  useEffect(() => {
    const next = stored.map(String);
    setSelection((current) =>
      current.length === next.length &&
      next.every((value, index) => value === current[index])
        ? current
        : next,
    );
  }, [stored]);

  const dirty = useMemo(() => {
    if (selection.length !== stored.length) return true;
    const current = new Set(stored.map(String));
    return selection.some((projectId) => !current.has(projectId));
  }, [selection, stored]);

  const options = projects.map((project) => ({
    value: String(project._id),
    label: project.name,
  }));

  const save = () => {
    setRefusal(null);
    setProjects.mutate(
      {
        organizationId,
        name,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every value came from the projects listing
        projectIds: selection as Array<Id<'projects'>>,
      },
      {
        onError: (error) => {
          setRefusal(automationErrorMessage(error));
        },
      },
    );
  };

  return (
    <section
      aria-labelledby={headingId}
      className="border-border flex h-full min-w-0 flex-col gap-4 rounded-lg border p-4"
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="text-sm font-semibold">
            {t('bindings.title')}
          </h3>
          {boundQuery.data !== undefined &&
            (stored.length === 0 ? (
              <Badge variant="slate">{t('bindings.orgBadge')}</Badge>
            ) : (
              <Badge variant="blue">
                {t('bindings.countBadge', { count: stored.length })}
              </Badge>
            ))}
        </div>
        <Text as="p" variant="muted" className="text-xs">
          {t('bindings.hint')}
        </Text>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}

        {options.length === 0 ? (
          <Text as="p" variant="muted" className="text-sm italic">
            {t('bindings.noProjects')}
          </Text>
        ) : (
          <MultiSelect
            value={selection}
            onValueChange={setSelection}
            options={options}
            placeholder={t('bindings.placeholder')}
            searchPlaceholder={t('bindings.searchPlaceholder')}
            emptyText={t('bindings.empty')}
            aria-label={t('bindings.title')}
            disabled={!canEdit}
            // Bound sets can be long; keep the panel height honest next to
            // Trigger and surface overflow with a scroll cue.
            chipsMaxHeightClassName="max-h-40"
          />
        )}
      </div>

      {canEdit && options.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            isLoading={setProjects.isPending}
            disabled={!dirty}
            disabledReason={t('bindings.nothingToSave')}
            onClick={save}
          >
            {t('bindings.save')}
          </Button>
        </div>
      )}
    </section>
  );
}
