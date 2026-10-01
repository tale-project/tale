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
 * main verb creates the task AND starts the agent. The task names this
 * conversation as its source, so the chat keeps a live row of it
 * (`ChatTaskTray`).
 */

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useProjectAgents } from '@/app/features/projects/hooks/queries';
import { TaskModal } from '@/app/features/tasks/components/task-modal';
import { chatMessagesQuery } from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';

import {
  useChatMessages,
  useChatProjects,
  useChatQueryClient,
} from '../data/chat-backend';
import { chatTaskDraft } from '../lib/chat-task-draft';

/** Long enough to read the toast and reach its action. */
const CREATED_TOAST_MS = 10_000;

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
  // saying who could add one.
  const withAgents = listed.filter((row) => (row.agentCount ?? 0) > 0);
  const withoutAgents = listed.filter((row) => (row.agentCount ?? 0) === 0);
  // A lone project is the answer; asking would be a step with one choice.
  const onlyProjectId =
    projects.status === 'ready' && listed.length === 1
      ? listed[0]?.id
      : undefined;
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  // Pre-picked when exactly one project has an agent: that is where the
  // work can start.
  const pickedOrDefault =
    pickedProjectId ??
    (withAgents.length === 1 ? (withAgents[0]?.id ?? null) : null);
  const [chosenProjectId, setChosenProjectId] = useState<string | undefined>(
    undefined,
  );
  const targetProjectId = homeProjectId ?? onlyProjectId ?? chosenProjectId;
  // The target project's agents: its only one is picked for the person.
  const agents = useProjectAgents(open ? targetProjectId : undefined);
  const onlyAgentId =
    agents.agents.length === 1 ? agents.agents[0]?._id : undefined;

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
  };

  const announce = (taskId: string, taskProjectId: string) => {
    const project = listed.find((row) => row.id === taskProjectId);
    toast({
      title: t('createTask.created', { project: project?.name ?? '' }),
      variant: 'success',
      duration: CREATED_TOAST_MS,
      action: (
        <ToastPrimitives.Action
          altText={t('createTask.openTaskAltText')}
          asChild
          onClick={() =>
            void navigate({
              to: '/dashboard/$id/projects/$projectId/tasks/board',
              params: { id: organizationId, projectId: taskProjectId },
              search: { task: taskId },
            })
          }
        >
          <Button type="button" variant="secondary" size="sm">
            {t('createTask.openTask')}
          </Button>
        </ToastPrimitives.Action>
      ),
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

  if (projects.status === 'loading' || draft === undefined) {
    return null;
  }

  if (targetProjectId !== undefined) {
    // The form reads its draft once, when it mounts: wait for the agent
    // list, so the project's one agent is already picked.
    if (agents.isLoading) return null;
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
              ...(withAgents.length > 0
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
                  ]
                : []),
              ...(withoutAgents.length > 0
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
