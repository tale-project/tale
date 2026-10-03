'use client';

import {
  projectTaskReviewerFromId,
  type ProjectTaskReviewer,
} from '@tale/shared/schemas/task-review';
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
 * silently overwrite a default changed while this form was open. */
export function ProjectTaskReviewerSection({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { project } = useProject(projectId);
  const { agents, isLoading: agentsLoading } = useProjectAgents(projectId);
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
    reviewer.kind === 'agent' && !agentsLoading && !selectedAgent;
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
      ...(!agentsLoading
        ? agents.map((agent) => ({
            value: 'agent:' + agent._id,
            label: agent.name,
            description: agent.tools?.includes('task_review')
              ? t('taskReview.agentHint')
              : t('taskReview.permissionRequired'),
          }))
        : []),
    ],
    [agents, agentsLoading, t],
  );
  if (!project) return null;

  return (
    <form onSubmit={editor.submit}>
      <fieldset
        disabled={
          !project.canEdit ||
          project.archivedAt !== undefined ||
          editor.isLoading ||
          editor.isSaving
        }
        className="contents"
      >
        <SettingsSection
          title={t('taskReview.title')}
          description={t('taskReview.description')}
        >
          <SettingsFieldRow
            label={t('taskReview.defaultReviewer')}
            description={t('taskReview.existingReviews')}
          >
            {({ labelId, descriptionId }) => (
              <Stack gap={2}>
                <SearchableSelect
                  value={
                    reviewer.kind === 'agent'
                      ? 'agent:' + reviewer.agentId
                      : 'human_default'
                  }
                  trigger={
                    <button
                      type="button"
                      className={selectTriggerClasses({})}
                      disabled={
                        agentsLoading ||
                        !project.canEdit ||
                        project.archivedAt !== undefined ||
                        editor.isLoading ||
                        editor.isSaving
                      }
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                    >
                      <span>
                        {reviewer.kind === 'agent'
                          ? (selectedAgent?.name ?? t('taskReview.unavailable'))
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
                  disabled={
                    agentsLoading ||
                    !project.canEdit ||
                    project.archivedAt !== undefined ||
                    editor.isLoading ||
                    editor.isSaving
                  }
                  aria-label={t('taskReview.defaultReviewer')}
                  searchPlaceholder={t('taskReview.search')}
                  emptyText={
                    agentsLoading
                      ? tCommon('actions.loading')
                      : tCommon('search.noResults')
                  }
                />
                {unavailable && (
                  <Text variant="caption">{t('taskReview.unavailable')}</Text>
                )}
                {missingPermission && (
                  <Text variant="caption">
                    {t('taskReview.permissionRequired')}
                  </Text>
                )}
              </Stack>
            )}
          </SettingsFieldRow>
        </SettingsSection>
      </fieldset>
    </form>
  );
}
