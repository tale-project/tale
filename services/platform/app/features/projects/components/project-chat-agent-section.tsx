'use client';

import {
  type ProjectChatAgent,
  sameProjectChatAgent,
} from '@tale/shared/schemas/projects';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Stack } from '@tale/ui/layout';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { selectTriggerClasses } from '@tale/ui/select';
import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import { SettingsFieldRow } from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useSetProjectChatAgent } from '../hooks/mutations';
import {
  useProject,
  useProjectChatAgents,
  useProjectHarnesses,
} from '../hooks/queries';

interface ChatAgentForm {
  chatAgent: ProjectChatAgent;
}

const FIRST = 'first';
const ASSISTANT = 'assistant';
const AGENT_PREFIX = 'agent:';

function valueOf(choice: ProjectChatAgent): string {
  return choice.kind === 'agent' ? AGENT_PREFIX + choice.agentId : choice.kind;
}

/**
 * Who a project's new chats answer as: the first agent created in it (the
 * default), one of its own agents, or the workspace's chat assistant.
 * Editors and admins change it on an active project; the save names the
 * choice this page read, so one made over someone else's change is refused
 * and says so. Chats that exist keep the agent they answer as; a person
 * switches in a chat's message box.
 */
export function ProjectChatAgentSection({ projectId }: { projectId: string }) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { project } = useProject(projectId);
  const chatAgents = useProjectChatAgents(projectId);
  const agents = useMemo(
    () => chatAgents.data?.agents ?? [],
    [chatAgents.data],
  );
  const answered = chatAgents.data !== undefined;
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusField = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger !== null && !trigger.disabled) trigger.focus();
    else fieldRef.current?.focus();
  }, []);
  const { mutateAsync: setChatAgent } = useSetProjectChatAgent();
  const expectedRef = useRef<ProjectChatAgent | undefined>(undefined);
  const data = useMemo<ChatAgentForm | undefined>(
    () =>
      chatAgents.data === undefined
        ? undefined
        : { chatAgent: chatAgents.data.chatAgent },
    [chatAgents.data],
  );
  const save = useCallback(
    async (draft: ChatAgentForm) => {
      try {
        await setChatAgent({
          projectId,
          chatAgent: draft.chatAgent,
          expected: expectedRef.current ?? draft.chatAgent,
        });
        expectedRef.current = draft.chatAgent;
      } catch (error) {
        const code = backendErrorCode(error);
        throw new Error(
          t(
            code === 'PROJECT_CHAT_AGENT_STALE'
              ? 'chatAgent.stale'
              : code === 'PROJECT_CHAT_AGENT_INVALID'
                ? 'chatAgent.invalid'
                : 'settings.saveError',
          ),
          { cause: error },
        );
      }
    },
    [projectId, setChatAgent, t],
  );
  const editor = useFormEditor<ChatAgentForm>({ data, save });
  useRegisterGroupedEditor(editor);
  const choice: ProjectChatAgent = editor.form.watch('chatAgent') ?? {
    kind: 'first',
  };
  const firstAgent = agents[0];
  // An agent's model by the name the model lists show, not its id.
  const roster = useProjectHarnesses(project?.organizationId ?? '').data;
  const options = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: FIRST,
        label: t('chatAgent.first'),
        description:
          firstAgent === undefined
            ? t('chatAgent.firstHintNone')
            : t('chatAgent.firstHint', { name: firstAgent.name }),
      },
      // The assistant before the agents, as the message box lists it.
      {
        value: ASSISTANT,
        label: t('chatAgent.assistant'),
        description: t('chatAgent.assistantHint'),
      },
      ...agents.map((agent) => ({
        value: AGENT_PREFIX + agent.id,
        label: agent.name,
        description:
          roster?.models.find(
            (row) =>
              row.id === agent.model &&
              (agent.modelProvider === null ||
                row.providerSlug === agent.modelProvider),
          )?.label ?? agent.model,
      })),
    ],
    [agents, firstAgent, roster, t],
  );
  if (!project) return null;

  const readOnly =
    !project.canEdit ||
    project.archivedAt !== undefined ||
    editor.isLoading ||
    editor.isSaving;
  const chosenAgent =
    choice.kind === 'agent'
      ? agents.find((agent) => agent.id === choice.agentId)
      : undefined;
  // "First agent created" names whom it means right now; a named agent that
  // is gone reads as what the server reads it as: the first agent created.
  const firstLabel =
    firstAgent === undefined
      ? t('chatAgent.first')
      : t('chatAgent.firstNamed', { name: firstAgent.name });
  const triggerLabel = !answered
    ? tCommon('actions.loading')
    : choice.kind === 'assistant'
      ? t('chatAgent.assistant')
      : choice.kind === 'agent'
        ? (chosenAgent?.name ?? firstLabel)
        : firstLabel;

  return (
    <form onSubmit={editor.submit}>
      <SettingsSection
        title={t('chatAgent.title')}
        description={t('chatAgent.description')}
      >
        <SettingsFieldRow
          label={t('chatAgent.field')}
          description={t('chatAgent.fieldHint')}
        >
          {({ labelId, descriptionId }) => (
            <Stack
              ref={fieldRef}
              gap={2}
              role="group"
              aria-labelledby={labelId}
              tabIndex={-1}
              className="outline-none"
              data-testid="project-chat-agent"
            >
              <fieldset disabled={readOnly} className="contents">
                <SearchableSelect
                  value={valueOf(choice)}
                  trigger={
                    <button
                      ref={triggerRef}
                      type="button"
                      className={selectTriggerClasses({})}
                      disabled={!answered || readOnly}
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                    >
                      <span className="truncate">{triggerLabel}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 opacity-50"
                      />
                    </button>
                  }
                  options={options}
                  onValueChange={(value) => {
                    const next: ProjectChatAgent | undefined =
                      value === FIRST
                        ? { kind: 'first' }
                        : value === ASSISTANT
                          ? { kind: 'assistant' }
                          : agents.some(
                                (agent) => AGENT_PREFIX + agent.id === value,
                              )
                            ? {
                                kind: 'agent',
                                agentId: value.slice(AGENT_PREFIX.length),
                              }
                            : undefined;
                    if (next === undefined) return;
                    if (!editor.isDirty) {
                      expectedRef.current = editor.form.getValues('chatAgent');
                    }
                    if (sameProjectChatAgent(next, choice)) return;
                    editor.form.setValue('chatAgent', next, {
                      shouldDirty: true,
                    });
                  }}
                  disabled={!answered || readOnly}
                  aria-label={t('chatAgent.field')}
                  align="start"
                  searchPlaceholder={t('chatAgent.search')}
                  emptyText={tCommon('search.noResults')}
                />
              </fieldset>
              {chatAgents.unavailable && (
                <CatalogLoadError
                  message={t('chatAgent.loadFailed')}
                  failureKey={chatAgents.failureCount}
                  isRetrying={chatAgents.retrying}
                  onRetry={chatAgents.retry}
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
