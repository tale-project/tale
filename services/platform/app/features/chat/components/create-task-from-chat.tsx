'use client';

/**
 * "Create task from chat": the conversation's hand-over to a project agent.
 * Chat answers questions and never produces files; a presentation, a report
 * or a spreadsheet is a task a project agent works on. This opens the task
 * dialog already holding what the person asked for, the files they shared,
 * and a link back — in the chat's own project, or one they pick first.
 *
 * The hand-over is meant to finish: the project step says which projects
 * have an agent (and who could add one where there is none), a lone project
 * is taken without asking, a project's only agent is picked, and the dialog's
 * main verb creates the task AND starts the agent. A project with no agent
 * of its own gets the organization's standard agent, when the organization
 * provides one: going on into it creates the agent there and picks it. The
 * task names this conversation as its source, so the chat keeps a live row
 * of it (`ChatTaskTray`).
 */

import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { useEnsureStandardAgent } from '@/app/features/projects/hooks/mutations';
import {
  useProjectAgents,
  useStandardAgentQuery,
} from '@/app/features/projects/hooks/queries';
import { TaskModal } from '@/app/features/tasks/components/task-modal';
import { toastTaskCreated } from '@/app/features/tasks/lib/task-created-toast';
import { taskRunErrorMessage } from '@/app/features/tasks/lib/task-run-error';
import { chatMessagesQuery } from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';

import {
  useChatMessages,
  useChatProjects,
  useChatQueryClient,
} from '../data/chat-backend';
import { chatTaskDraft } from '../lib/chat-task-draft';

interface CreateTaskFromChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The conversation's root — the link back names it. */
  threadId: string;
  /** The sibling on screen, whose messages the task draws on. */
  viewThreadId: string;
  threadTitle: string | undefined;
  /** The project the chat is filed in, when it is. */
  projectId: string | undefined;
  /** The person reading owns the conversation: their files may ride along. */
  viewerIsOwner: boolean;
}

export function CreateTaskFromChat({
  open,
  onOpenChange,
  organizationId,
  threadId,
  viewThreadId,
  threadTitle,
  projectId,
  viewerIsOwner,
}: CreateTaskFromChatProps) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const { t: tTasks } = useT('tasks');
  const navigate = useNavigate();
  const projects = useChatProjects(organizationId);
  const messages = useChatMessages(
    organizationId,
    open ? viewThreadId : undefined,
  );

  // The chat's own project unless the list says it is gone (an archived
  // project no longer lists); otherwise the person picks one first. A list
  // that failed to load drops nothing: the create itself refuses a project
  // the person cannot use.
  const listed = projects.status === 'ready' ? projects.data : [];
  const homeProjectId =
    projectId !== undefined &&
    (projects.status !== 'ready' || listed.some((row) => row.id === projectId))
      ? projectId
      : undefined;
  // Where work can go: projects with an agent first, then the rest, each
  // saying who could add one — or, while the organization provides a
  // standard agent, saying it takes the work there.
  const standardAgentQuery = useStandardAgentQuery(
    open ? organizationId : undefined,
  );
  const standardAgentAvailable = standardAgentQuery.data?.available === true;
  const withAgents = listed.filter((row) => (row.agentCount ?? 0) > 0);
  const withoutAgents = listed.filter((row) => (row.agentCount ?? 0) === 0);
  // A lone project is the answer; asking would be a step with one choice.
  const onlyProjectId =
    projects.status === 'ready' && listed.length === 1
      ? listed[0]?.id
      : undefined;
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  // Pre-picked when exactly one project has an agent: that is where the
  // work can start. With a standard agent, every project has one.
  const startable = standardAgentAvailable ? listed : withAgents;
  const pickedOrDefault =
    pickedProjectId ??
    (startable.length === 1 ? (startable[0]?.id ?? null) : null);
  const [chosenProjectId, setChosenProjectId] = useState<string | undefined>(
    undefined,
  );
  const targetProjectId = homeProjectId ?? onlyProjectId ?? chosenProjectId;
  // The target project's agents: its only one is picked for the person.
  const agents = useProjectAgents(open ? targetProjectId : undefined);
  // A target with none of its own gets the organization's standard agent,
  // created once the person has chosen the project — so the form opens with
  // it picked, as with any project's only agent. A refusal opens the form
  // unassigned and says why.
  const { mutateAsync: ensureStandardAgent } = useEnsureStandardAgent();
  const [standardAgent, setStandardAgent] = useState<
    { projectId: string; agentId: string | null } | undefined
  >(undefined);
  const needsStandardAgent =
    open &&
    targetProjectId !== undefined &&
    standardAgentAvailable &&
    !agents.isLoading &&
    agents.agents.length === 0;
  useEffect(() => {
    if (!needsStandardAgent || targetProjectId === undefined) return undefined;
    if (standardAgent?.projectId === targetProjectId) return undefined;
    let cancelled = false;
    ensureStandardAgent({ projectId: targetProjectId }).then(
      ({ agentId }) => {
        if (!cancelled)
          setStandardAgent({ projectId: targetProjectId, agentId });
      },
      (error: unknown) => {
        console.warn(
          '[chat] the standard agent could not be added for the hand-over',
          error,
        );
        if (cancelled) return;
        setStandardAgent({ projectId: targetProjectId, agentId: null });
        toast({
          title:
            taskRunErrorMessage(error, tTasks) ?? tCommon('errors.generic'),
          variant: 'destructive',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    ensureStandardAgent,
    needsStandardAgent,
    standardAgent?.projectId,
    targetProjectId,
    tCommon,
    tTasks,
  ]);
  const ensuredAgentId =
    standardAgent?.projectId === targetProjectId
      ? (standardAgent?.agentId ?? undefined)
      : undefined;
  const onlyAgentId =
    ensuredAgentId ??
    (agents.agents.length === 1 ? agents.agents[0]?._id : undefined);

  // The draft is taken from a conversation that was actually read: the form
  // keeps what it opened with, so a read that failed must not open it with
  // the request and files missing. A chat with no messages is still a read.
  const draft = useMemo(() => {
    if (messages.status !== 'ready') return undefined;
    return {
      ...chatTaskDraft({
        title: threadTitle,
        messages: messages.data,
        chatUrl: `${window.location.origin}/dashboard/${organizationId}/chat/${threadId}`,
        linkLabel: {
          titled: (title) => t('createTask.fromChat', { title }),
          untitled: t('createTask.fromChatUntitled'),
        },
        includeAttachments: viewerIsOwner,
      }),
      sourceThreadId: threadId,
      startAgent: true,
      ...(onlyAgentId !== undefined
        ? { assignee: { type: 'agent' as const, id: onlyAgentId } }
        : {}),
    };
  }, [
    messages,
    threadTitle,
    organizationId,
    threadId,
    viewerIsOwner,
    onlyAgentId,
    t,
  ]);

  const queryClient = useChatQueryClient();
  const [retrying, setRetrying] = useState(false);
  const retryRead = async () => {
    setRetrying(true);
    try {
      await queryClient.refetchQueries({
        queryKey: chatMessagesQuery(organizationId, viewThreadId).queryKey,
      });
    } catch (error) {
      console.warn(
        '[chat] re-reading the conversation for a task failed',
        error,
      );
    } finally {
      setRetrying(false);
    }
  };

  const close = () => {
    onOpenChange(false);
    setPickedProjectId(null);
    setChosenProjectId(undefined);
    setStandardAgent(undefined);
  };

  const announce = (taskId: string, taskProjectId: string) => {
    const project = listed.find((row) => row.id === taskProjectId);
    toastTaskCreated({
      title: t('createTask.created', { project: project?.name ?? '' }),
      openLabel: t('createTask.openTask'),
      openAltText: t('createTask.openTaskAltText'),
      onOpen: () =>
        void navigate({
          to: '/dashboard/$id/projects/$projectId/tasks/board',
          params: { id: organizationId, projectId: taskProjectId },
          search: { task: taskId },
        }),
    });
  };

  if (!open) return null;

  if (messages.status === 'unavailable') {
    return (
      <FormDialog
        open
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t('createTask.projectTitle')}
        submitText={t('tryAgain')}
        isSubmitting={retrying}
        isValid
        onSubmit={() => void retryRead()}
      >
        <Text variant="muted" className="text-sm" role="alert">
          {t('createTask.readFailed')}
        </Text>
      </FormDialog>
    );
  }

  // Whether the standard agent takes work decides how the projects group
  // and whether the form opens assigned: wait for its first answer as for
  // the list, so neither shows once one way and then again the other. A
  // read that failed once goes on without it rather than through retries.
  if (
    projects.status === 'loading' ||
    draft === undefined ||
    (standardAgentQuery.isLoading && standardAgentQuery.failureCount === 0)
  ) {
    return null;
  }

  if (targetProjectId !== undefined) {
    // The form reads its draft once, when it mounts: wait for the agent
    // list — and for the standard agent a project without one gets — so the
    // project's one agent is already picked.
    if (agents.isLoading) return null;
    if (needsStandardAgent && standardAgent?.projectId !== targetProjectId) {
      return null;
    }
    return (
      <TaskModal
        open
        onOpenChange={(next) => {
          if (!next) close();
        }}
        organizationId={organizationId}
        projectId={targetProjectId}
        draft={draft}
        onTaskCreated={(taskId) => announce(taskId, targetProjectId)}
      />
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t('createTask.projectTitle')}
      description={t('createTask.projectDescription')}
      submitText={t('createTask.continue')}
      isValid={pickedOrDefault !== null}
      onSubmit={() => {
        if (pickedOrDefault !== null) setChosenProjectId(pickedOrDefault);
      }}
    >
      <FormSection>
        {projects.status === 'unavailable' ? (
          <Text variant="muted" className="text-sm">
            {tCommon('errors.generic')}
          </Text>
        ) : listed.length === 0 ? (
          <Text variant="muted" className="text-sm">
            {t('createTask.noProjects')}
          </Text>
        ) : (
          <SearchableSelect
            id="create-task-from-chat-project"
            label={t('createTask.projectLabel')}
            placeholder={t('createTask.projectPlaceholder')}
            required
            value={pickedOrDefault}
            onValueChange={(value) => {
              if (!value.startsWith('__section:')) setPickedProjectId(value);
            }}
            options={[
              ...(withAgents.length > 0 ||
              (standardAgentAvailable && withoutAgents.length > 0)
                ? [
                    {
                      value: '__section:with-agents',
                      label: t('createTask.withAgents'),
                      isSectionHeader: true,
                    },
                    ...withAgents.map((row) => ({
                      value: row.id,
                      label: row.name,
                      description: t('createTask.agentCount', {
                        count: row.agentCount ?? 0,
                      }),
                    })),
                    // The organization's standard agent takes the work in
                    // a project with no agent of its own.
                    ...(standardAgentAvailable
                      ? withoutAgents.map((row) => ({
                          value: row.id,
                          label: row.name,
                          description: t('createTask.standardAgent'),
                        }))
                      : []),
                  ]
                : []),
              ...(withoutAgents.length > 0 && !standardAgentAvailable
                ? [
                    {
                      value: '__section:without-agents',
                      label: t('createTask.withoutAgents'),
                      isSectionHeader: true,
                    },
                    ...withoutAgents.map((row) => ({
                      value: row.id,
                      label: row.name,
                      // Who can close the gap: an editor adds one from the
                      // task itself; anyone else asks.
                      description: t(
                        row.canEdit === true
                          ? 'createTask.noAgentEditor'
                          : 'createTask.noAgentReader',
                      ),
                    })),
                  ]
                : []),
            ]}
            emptyText={t('createTask.projectEmpty')}
          />
        )}
      </FormSection>
    </FormDialog>
  );
}
