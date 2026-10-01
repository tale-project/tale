'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import { toast } from '@tale/ui/use-toast';
import { useTriggerTooltipGuard } from '@tale/ui/use-trigger-tooltip-guard';
import { CircleHelp, Plus, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { ProjectAgentCreateDialog } from '@/app/features/projects/components/project-agent-create-dialog';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendClient } from '@/app/hooks/use-backend-client';
import { useT } from '@/lib/i18n/client';

import { useCancelTaskAgentRun } from '../hooks/mutations';
import { useAssignableActors } from '../hooks/use-actor-directory';
import {
  taskSubjectEntries,
  useTaskContractAutomations,
} from '../hooks/use-task-subject-contract';
import type { TaskActorType } from '../lib/display';
import { taskRunErrorMessage } from '../lib/task-run-error';
import { AssigneeAvatar } from './assignee-avatar';

/** The change a confirmed handoff performs. */
type PendingAssign =
  | { kind: 'assign'; type: TaskActorType; id: string }
  | { kind: 'unassign' };

/** Sentinel option value: not an assignee but the way OUT of having none —
 * selecting it opens the New agent dialog in place. Offered to the project's
 * editors, who alone may add agents. */
const CREATE_AGENT_ACTION = '__action:create-agent';

/** Sentinel option value: the organization's standard agent, offered in a
 * project with no agents of its own to everyone who can open it. Selecting
 * it creates the project's standard agent (`ensureStandardAgent`) and
 * assigns it. */
const STANDARD_AGENT_ACTION = '__action:standard-agent';

/**
 * Assignee control built on the same {@link SearchableSelect} as the chat model
 * and agent selectors: the assignee avatar is the (icon-button) trigger, and a
 * searchable list offers the current user first (self-assign), then the other
 * members, then project Agents, then the project's subject-contract Automations
 * (so a task handed away from its automation can be handed BACK — reassignment
 * is a two-way door), with an Unassign action in the footer.
 *
 * A project with no agent of its own offers the organization's standard
 * agent to everyone who can open it, while the organization provides one:
 * picking it creates the project's standard agent and assigns it. An editor
 * also gets "Create an agent…", which opens the New agent dialog over the
 * picker and assigns the agent it creates — nothing navigates away, so a
 * task being drafted keeps its draft. Without a standard agent, anyone else
 * is told in the footer that an Editor or Admin can add one, because the
 * row they used to get sent them to a tab they cannot change.
 *
 * Taking a task away from an automation is an ownership TRANSFER, not a field
 * edit: when `taskId` is provided, moving off an `app` assignee asks first,
 * and a live run is cancelled as part of the confirmed transfer (the server
 * refuses the reassign otherwise — `TASK_HAS_LIVE_RUN`).
 *
 * When `disabled` (no edit permission) it renders the bare avatar with no menu.
 */
export function AssigneePicker({
  organizationId,
  projectId,
  taskId,
  assigneeType,
  assigneeId,
  onAssign,
  onUnassign,
  size = 'sm',
  align = 'start',
  disabled = false,
  afterTrigger,
}: {
  organizationId: string;
  projectId?: string;
  /** Enables the ownership-transfer guard (confirm + cancel-then-reassign)
   * and is required for it — pickers without a bound task keep the bare
   * assign behavior. */
  taskId?: string;
  assigneeType?: TaskActorType;
  assigneeId?: string;
  onAssign: (type: TaskActorType, id: string) => void;
  onUnassign: () => void;
  size?: 'sm' | 'md';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  /** Renders beside the avatar trigger (e.g. assignee name in the task modal). */
  afterTrigger?: ReactNode;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const {
    assignableMembers,
    assignableAgents,
    agentsLoading,
    currentUserId,
    resolveActor,
    // Agents are the project editors' to add; everyone else reads them.
    canAddAgents,
    projectResolved,
    standardAgentAvailable,
  } = useAssignableActors(organizationId, projectId);
  // Settled on "this project has no agent", so neither the create row nor
  // the reader's note flashes over a list or a role that is still loading.
  // A project the read could not return stays silent: who may add to it is
  // unknown.
  const projectHasNoAgents =
    projectId !== undefined &&
    !agentsLoading &&
    projectResolved &&
    assignableAgents.length === 0;
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const offerStandardAgent = projectHasNoAgents && standardAgentAvailable;
  const automations = useTaskContractAutomations(organizationId, projectId);
  const { locale } = useLocale();
  const subjectEntries = useMemo(
    () => taskSubjectEntries(automations, locale),
    [automations, locale],
  );
  const client = useBackendClient();
  const cancelWorkflowRun = useBackendAction(
    'tasks/public_actions:cancelTaskWorkflow',
  );
  const { mutateAsync: cancelAgentRun } = useCancelTaskAgentRun();
  const [open, setOpen] = useState(false);
  // The trigger's name tip stays shut while its list or the New agent
  // dialog is open, and does not flash back when focus returns to it.
  const tooltipGuard = useTriggerTooltipGuard(open || createAgentOpen);
  const [pending, setPending] = useState<PendingAssign | null>(null);
  const [pendingLiveRun, setPendingLiveRun] = useState<
    'automation' | 'agent' | null
  >(null);
  const [handoffBusy, setHandoffBusy] = useState(false);

  const resolved =
    assigneeType && assigneeId ? resolveActor(assigneeType, assigneeId) : null;

  const sectionInfoButton = useCallback(
    (content: string): ReactNode => (
      <Tooltip content={content} side="right">
        <button
          type="button"
          aria-label={tCommon('aria.moreInfo')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex rounded align-middle focus-visible:ring-1 focus-visible:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
    ),
    [tCommon],
  );

  const label = resolved?.name ?? t('assignee.unassigned');

  const assignedToCurrentUser =
    assigneeType === 'user' &&
    !!assigneeId &&
    !!currentUserId &&
    assigneeId === currentUserId;

  const avatar = (
    <AssigneeAvatar
      assigneeType={assigneeType}
      assigneeId={assigneeId}
      name={resolved?.name}
      isCurrentUser={assignedToCurrentUser}
      size={size}
    />
  );

  const options = useMemo<SearchableSelectOption[]>(() => {
    const sortedMembers = [...assignableMembers].sort((a, b) =>
      a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0,
    );
    const memberOptions: SearchableSelectOption[] = sortedMembers.map((m) => ({
      value: `user:${m.id}`,
      label: m.name,
      description: m.id === currentUserId ? t('assignee.assignToMe') : m.email,
      labelBadge:
        m.id === currentUserId ? (
          <Badge variant="outline" className="text-[10px]">
            {t('assignee.you')}
          </Badge>
        ) : undefined,
    }));

    const agentOption = (
      agent: (typeof assignableAgents)[number],
    ): SearchableSelectOption => ({
      value: `agent:${agent.id}`,
      label: agent.name,
    });

    // One plain "Agents" section — the entries are the project's own created
    // agents, not a third-party roster, so no platform/external split.
    const agentSections: SearchableSelectOption[] = [];
    if (assignableAgents.length > 0) {
      agentSections.push({
        value: '__section:agents',
        label: t('assignee.agents'),
        isSectionHeader: true,
        labelBadge: sectionInfoButton(t('assignee.agentsInfo')),
      });
      agentSections.push(...assignableAgents.map(agentOption));
    } else if (offerStandardAgent || (projectHasNoAgents && canAddAgents)) {
      // A project with no agents yet still shows the section: the
      // organization's standard agent to everyone, and the way to add one
      // to whoever may — otherwise the ability to hand tasks to an agent is
      // invisible exactly when the user has never met it. Everyone else
      // reads the facts in the footer, as text rather than as a row nothing
      // can select.
      agentSections.push({
        value: '__section:agents',
        label: t('assignee.agents'),
        isSectionHeader: true,
        labelBadge: sectionInfoButton(t('assignee.agentsInfo')),
      });
      if (offerStandardAgent) {
        agentSections.push({
          value: STANDARD_AGENT_ACTION,
          label: t('assignee.standardAgent'),
          description: t('assignee.standardAgentHint'),
        });
      }
      if (canAddAgents) {
        agentSections.push({
          value: CREATE_AGENT_ACTION,
          label: t('assignee.createAgent'),
          description: t('assignee.createAgentHint'),
        });
      }
    }

    // The subject-contract automations visible from this board — the way an
    // owned task handed to a person can be handed BACK to its workflow.
    const automationSections: SearchableSelectOption[] = [];
    if (subjectEntries.length > 0) {
      automationSections.push({
        value: '__section:automations',
        label: t('assignee.automations'),
        isSectionHeader: true,
        labelBadge: sectionInfoButton(t('assignee.automationsInfo')),
      });
      automationSections.push(
        ...subjectEntries.map((entry) => ({
          value: `app:${entry.automationSlug}`,
          label: entry.displayName,
        })),
      );
    }

    return [...memberOptions, ...agentSections, ...automationSections];
  }, [
    assignableMembers,
    assignableAgents,
    offerStandardAgent,
    projectHasNoAgents,
    canAddAgents,
    currentUserId,
    subjectEntries,
    t,
    sectionInfoButton,
  ]);

  if (disabled) {
    // max-w-full on both trigger rows: an inline-flex box sizes to its
    // content, so inside a narrow value cell (the task modal's side panel)
    // it would push past the panel instead of letting the name truncate.
    return (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <Tooltip content={label}>
          <span className="inline-flex">{avatar}</span>
        </Tooltip>
        {afterTrigger}
      </span>
    );
  }

  const value =
    assigneeType && assigneeId ? `${assigneeType}:${assigneeId}` : null;

  const parseOptionValue = (
    val: string,
  ): { type: TaskActorType; id: string } => {
    const type: TaskActorType = val.startsWith('agent:')
      ? 'agent'
      : val.startsWith('app:')
        ? 'app'
        : 'user';
    return { type, id: val.slice(val.indexOf(':') + 1) };
  };

  /** Whether this change takes the task away from its current worker in a way
   * that deserves a confirm: off an automation always (ownership transfer);
   * off an agent only when its run is live (detected below). */
  const guardedHandoff = taskId !== undefined && assigneeType === 'app';

  const applyChange = (change: PendingAssign) => {
    if (change.kind === 'assign') onAssign(change.type, change.id);
    else onUnassign();
  };

  /** Route a change through the transfer guard: query the live engines, ask
   * when the handoff has a consequence, otherwise apply directly. */
  const requestChange = (change: PendingAssign) => {
    if (taskId === undefined || projectId === undefined) {
      applyChange(change);
      return;
    }
    if (
      change.kind === 'assign' &&
      change.type === assigneeType &&
      change.id === assigneeId
    ) {
      return; // no-op reselect of the current assignee.
    }
    void (async () => {
      let liveRun: 'automation' | 'agent' | null = null;
      try {
        const [automationRun, agentRun] = await Promise.all([
          client.query('automations/queries:getLiveRunForTask', {
            organizationId,
            projectId,
            taskId,
          }),
          client.query('tasks/queries:getLatestTaskAgentRunForTask', {
            organizationId,
            taskId,
          }),
        ]);
        if (automationRun !== null) liveRun = 'automation';
        else if (
          agentRun !== null &&
          (agentRun.status === 'queued' || agentRun.status === 'running')
        ) {
          liveRun = 'agent';
        }
      } catch (error) {
        // The guard is best-effort UX — the server gate still refuses a
        // mid-run transfer, so a failed read must not block the picker.
        console.warn('[tasks] assignee live-run check failed', error);
      }
      if (guardedHandoff || liveRun !== null) {
        setPending(change);
        setPendingLiveRun(liveRun);
      } else {
        applyChange(change);
      }
    })();
  };

  const confirmHandoff = async () => {
    if (pending === null || taskId === undefined) return;
    setHandoffBusy(true);
    try {
      if (pendingLiveRun === 'automation') {
        await cancelWorkflowRun.mutateAsync({ organizationId, taskId });
      } else if (pendingLiveRun === 'agent') {
        await cancelAgentRun({ taskId });
      }
      applyChange(pending);
      setPending(null);
      setPendingLiveRun(null);
    } catch (error) {
      // The cancel's own toast reports the failure.
      console.error('[tasks] handoff cancel-then-reassign failed', error);
    } finally {
      setHandoffBusy(false);
    }
  };

  /** Create the project's standard agent (or find the one a colleague
   * just created) and hand it the task. */
  const assignStandardAgent = async () => {
    if (projectId === undefined) return;
    try {
      const { agentId } = await client.mutation(
        'projects/mutations:ensureStandardAgent',
        { projectId },
      );
      requestChange({ kind: 'assign', type: 'agent', id: agentId });
    } catch (error) {
      console.error('[tasks] the standard agent could not be added', error);
      toast({
        title: taskRunErrorMessage(error, t) ?? tCommon('errors.generic'),
        variant: 'destructive',
      });
    }
  };

  const handleSelect = (val: string) => {
    if (val.startsWith('__section:')) return;
    if (val === CREATE_AGENT_ACTION) {
      setOpen(false);
      setCreateAgentOpen(true);
      return;
    }
    if (val === STANDARD_AGENT_ACTION) {
      setOpen(false);
      void assignStandardAgent();
      return;
    }
    const { type, id } = parseOptionValue(val);
    requestChange({ kind: 'assign', type, id });
  };

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('actions.assign')}
      className="h-auto w-auto rounded-full p-1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {avatar}
    </Button>
  );

  const select = (
    <SearchableSelect
      value={value}
      onValueChange={handleSelect}
      options={options}
      open={open}
      onOpenChange={(next) => {
        if (!next) tooltipGuard.suppressNextOpen();
        setOpen(next);
      }}
      align={align}
      modal
      trigger={trigger}
      searchPlaceholder={t('assignee.search')}
      emptyText={tCommon('search.noResults')}
      aria-label={t('fields.assignee')}
      optionAction={(opt) => {
        if (opt.isSectionHeader) return null;
        if (opt.value === CREATE_AGENT_ACTION) {
          return <Plus className="text-muted-foreground size-4" aria-hidden />;
        }
        if (opt.value === STANDARD_AGENT_ACTION) {
          // Drawn as the agent it becomes; the id only fills the slot.
          return (
            <AssigneeAvatar
              assigneeType="agent"
              assigneeId={STANDARD_AGENT_ACTION}
              name={opt.label}
            />
          );
        }
        const parsed = parseOptionValue(opt.value);
        return (
          <AssigneeAvatar
            assigneeType={parsed.type}
            assigneeId={parsed.id}
            name={opt.label}
            isCurrentUser={
              parsed.type === 'user' && parsed.id === currentUserId
            }
          />
        );
      }}
      footer={
        <Stack gap={0}>
          {/* #2610: only installed + enabled agents ever reach this list
              — a connected connector alone does not make its bundled
              agents assignable, so a familiar name (e.g. an
              connector's own agent) can be legitimately absent, up to
              and including the whole Agents section. Always shown (not
              gated on the section being non-empty) so that exact "why
              can't I find it" case still gets an answer. */}
          <Text variant="muted" className="px-2 py-1 text-[11px] text-wrap">
            {t(
              offerStandardAgent
                ? 'assignee.standardAgentFooter'
                : canAddAgents
                  ? 'assignee.liveAgentsOnly'
                  : projectHasNoAgents
                    ? 'assignee.noAgentsReader'
                    : 'assignee.liveAgentsOnlyReader',
            )}
          </Text>
          {assigneeId && (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              icon={UserX}
              onClick={() => {
                requestChange({ kind: 'unassign' });
                setOpen(false);
              }}
            >
              {t('assignee.unassign')}
            </Button>
          )}
        </Stack>
      }
    />
  );

  const handoffDialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next && !handoffBusy) {
          setPending(null);
          setPendingLiveRun(null);
        }
      }}
      title={t('assignee.handoffConfirmTitle')}
      description={
        pendingLiveRun !== null
          ? t('assignee.handoffConfirmLiveRun', { name: label })
          : t('assignee.handoffConfirm', { name: label })
      }
      confirmText={t('assignee.handoffConfirmAction')}
      isLoading={handoffBusy}
      onConfirm={() => void confirmHandoff()}
    />
  );

  return (
    <Tooltip
      content={label}
      open={tooltipGuard.open}
      onOpenChange={tooltipGuard.onOpenChange}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary */}
      <span
        className="inline-flex max-w-full min-w-0 items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {select}
        {afterTrigger}
        {handoffDialog}
        {/* Mounted only while open: the form's reads (runtimes, models,
            skills) are its own, not this picker's. */}
        {createAgentOpen && projectId !== undefined && (
          <ProjectAgentCreateDialog
            organizationId={organizationId}
            projectId={projectId}
            open={createAgentOpen}
            onOpenChange={(next) => {
              if (!next) tooltipGuard.suppressNextOpen();
              setCreateAgentOpen(next);
            }}
            // The agent was created to take this task: assign it.
            onCreated={(agentId) =>
              requestChange({ kind: 'assign', type: 'agent', id: agentId })
            }
          />
        )}
      </span>
    </Tooltip>
  );
}
