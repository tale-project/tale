'use client';

import {
  projectTaskReviewerFromId,
  type ProjectTaskReviewer,
} from '@tale/shared/schemas/task-review';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Stack } from '@tale/ui/layout';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { selectTriggerClasses } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import { SettingsFieldRow } from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useSetProjectTaskReviewer } from '../hooks/mutations';
import { useProject, useProjectAgents } from '../hooks/queries';

interface ReviewerForm {
  reviewer: ProjectTaskReviewer;
}

/** The baseline stays with the editable draft, so a second editor cannot
 * silently overwrite a default changed while this form was open.
 *
 * Only an agent list that answered can tell that the saved agent is gone.
 * While the list loads, or after it failed to load, the saved choice stays
 * as it is and cannot be changed; a failed list says so with **Try again**
 * (#4644). */
export function ProjectTaskReviewerSection({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { project } = useProject(projectId);
  const {
    agents,
    hasAnswer: agentsAnswered,
    unavailable: agentsUnavailable,
    retrying: agentsRetrying,
    failureCount: agentsFailures,
    retry: retryAgents,
  } = useProjectAgents(projectId);
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Once Try again brings the list back, its focus goes to the picker — or,
  // where the picker stays read-only, to the field around it.
  const focusField = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger !== null && !trigger.disabled) trigger.focus();
    else fieldRef.current?.focus();
  }, []);
  const { mutateAsync: setReviewer } = useSetProjectTaskReviewer();
  const expectedRef = useRef<ProjectTaskReviewer | undefined>(undefined);
  const data = useMemo<ReviewerForm | undefined>(() => {
    if (!project) return undefined;
    const reviewer = projectTaskReviewerFromId(
      project.defaultTaskReviewerAgentId,
    );
    return { reviewer };
  }, [project]);
  const save = useCallback(
    async (draft: ReviewerForm) => {
      try {
        await setReviewer({
          projectId,
          reviewer: draft.reviewer,
          expected: expectedRef.current ?? draft.reviewer,
        });
        expectedRef.current = draft.reviewer;
      } catch (error) {
        const code = backendErrorCode(error);
        throw new Error(
          t(
            code === 'PROJECT_REVIEWER_STALE'
              ? 'taskReview.stale'
              : code === 'PROJECT_REVIEWER_PERMISSION_MISSING'
                ? 'taskReview.permissionRequired'
                : code === 'PROJECT_REVIEWER_INVALID'
                  ? 'taskReview.unavailable'
                  : 'settings.saveError',
          ),
          { cause: error },
        );
      }
    },
    [projectId, setReviewer, t],
  );
  const editor = useFormEditor<ReviewerForm>({ data, save });
  useRegisterGroupedEditor(editor);
  const reviewer = editor.form.watch('reviewer') ?? { kind: 'human_default' };
  const selectedAgent =
    reviewer.kind === 'agent'
      ? agents.find((agent) => agent._id === reviewer.agentId)
      : undefined;
  const unavailable =
    reviewer.kind === 'agent' && agentsAnswered && !selectedAgent;
  const missingPermission =
    selectedAgent !== undefined &&
    !selectedAgent.tools?.includes('task_review');
  const options = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: 'human_default',
        label: t('taskReview.humanDefault'),
        description: t('taskReview.humanDefaultHint'),
      },
      ...agents.map((agent) => ({
        value: 'agent:' + agent._id,
        label: agent.name,
        description: agent.tools?.includes('task_review')
          ? t('taskReview.agentHint')
          : t('taskReview.permissionRequired'),
      })),
    ],
    [agents, t],
  );
  if (!project) return null;

  const readOnly =
    !project.canEdit ||
    project.archivedAt !== undefined ||
    editor.isLoading ||
    editor.isSaving;
  // The saved agent by name, or why there is none: it is gone from the list
  // that answered, or the list is loading, or it failed to load (the notice
  // below says so).
  const agentLabel =
    selectedAgent?.name ??
    (unavailable
      ? t('taskReview.unavailable')
      : agentsUnavailable
        ? t('taskReview.agentNotLoaded')
        : tCommon('actions.loading'));

  return (
    <form onSubmit={editor.submit}>
      <SettingsSection
        title={t('taskReview.title')}
        description={t('taskReview.description')}
      >
        <SettingsFieldRow
          label={t('taskReview.defaultReviewer')}
          description={t('taskReview.existingReviews')}
        >
          {({ labelId, descriptionId }) => (
            // A named group the focus can return to when the picker cannot
            // take it.
            <Stack
              ref={fieldRef}
              gap={2}
              role="group"
              aria-labelledby={labelId}
              tabIndex={-1}
              className="outline-none"
            >
              <fieldset disabled={readOnly} className="contents">
                <SearchableSelect
                  value={
                    reviewer.kind === 'agent'
                      ? 'agent:' + reviewer.agentId
                      : 'human_default'
                  }
                  trigger={
                    <button
                      ref={triggerRef}
                      type="button"
                      className={selectTriggerClasses({})}
                      // No choice is offered from a list that has not
                      // answered: the saved one stays until it does.
                      disabled={!agentsAnswered || readOnly}
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                    >
                      <span>
                        {reviewer.kind === 'agent'
                          ? agentLabel
                          : t('taskReview.humanDefault')}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 opacity-50"
                      />
                    </button>
                  }
                  options={options}
                  onValueChange={(value) => {
                    const agent = agents.find(
                      (candidate) => 'agent:' + candidate._id === value,
                    );
                    if (value !== 'human_default' && !agent) return;
                    if (!editor.isDirty) {
                      expectedRef.current = editor.form.getValues('reviewer');
                    }
                    if (value === 'human_default') {
                      editor.form.setValue(
                        'reviewer',
                        { kind: 'human_default' },
                        { shouldDirty: true },
                      );
                    } else if (agent) {
                      editor.form.setValue(
                        'reviewer',
                        { kind: 'agent', agentId: agent._id },
                        { shouldDirty: true },
                      );
                    }
                  }}
                  disabled={!agentsAnswered || readOnly}
                  aria-label={t('taskReview.defaultReviewer')}
                  searchPlaceholder={t('taskReview.search')}
                  emptyText={tCommon('search.noResults')}
                />
                {unavailable && (
                  <Text variant="caption">{t('taskReview.unavailable')}</Text>
                )}
                {missingPermission && (
                  <Text variant="caption">
                    {t('taskReview.permissionRequired')}
                  </Text>
                )}
              </fieldset>
              {/* Outside the fieldset, so Try again works where the picker is
                  read-only too: for a reader, on an archived project. */}
              {agentsUnavailable && (
                <CatalogLoadError
                  message={t('agents.loadFailed')}
                  // Each failure is announced again; Try again keeps its node.
                  failureKey={agentsFailures}
                  isRetrying={agentsRetrying}
                  onRetry={retryAgents}
                  onFocusLost={focusField}
                />
              )}
            </Stack>
          )}
        </SettingsFieldRow>
      </SettingsSection>
    </form>
  );
}
