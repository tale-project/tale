'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Info, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexClient } from '@/app/hooks/use-convex-client';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useCancelTaskAgentRun } from '../hooks/mutations';
import { useAssignableActors } from '../hooks/use-actor-directory';
import {
  taskSubjectEntries,
  useTaskContractAutomations,
} from '../hooks/use-task-subject-contract';
import { looksLikeCodeTask } from '../lib/agent-display';
import type { TaskActorType } from '../lib/display';
import { AssigneeAvatar } from './assignee-avatar';

/** The change a confirmed handoff performs. */
type PendingAssign =
  | { kind: 'assign'; type: TaskActorType; id: string }
  | { kind: 'unassign' };

/**
 * Assignee control built on the same {@link SearchableSelect} as the chat model
 * and agent selectors: the assignee avatar is the (icon-button) trigger, and a
 * searchable list offers the current user first (self-assign), then the other
 * members, then project Agents, then the project's subject-contract Automations
 * (so a task handed away from its automation can be handed BACK — reassignment
 * is a two-way door), with an Unassign action in the footer.
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
  taskTitle,
  taskDescription,
  taskLabels,
  afterTrigger,
}: {
  organizationId: string;
  projectId?: Id<'projects'>;
  /** Enables the ownership-transfer guard (confirm + cancel-then-reassign)
   * and is required for it — pickers without a bound task keep the bare
   * assign behavior. */
  taskId?: Id<'tasks'>;
  assigneeType?: TaskActorType;
  assigneeId?: string;
  onAssign: (type: TaskActorType, id: string) => void;
  onUnassign: () => void;
  size?: 'sm' | 'md';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  /** When set, enables the third-party-agent / non-code-task guidance under
   * the trigger. */
  taskTitle?: string;
  taskDescription?: string;
  taskLabels?: string[];
  /** Renders beside the avatar trigger (e.g. assignee name in the task modal). */
  afterTrigger?: ReactNode;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const {
    assignableMembers,
    assignableAgents,
    agents,
    currentUserId,
    resolveActor,
  } = useAssignableActors(organizationId, projectId);
  const automations = useTaskContractAutomations(organizationId, projectId);
  const { locale } = useLocale();
  const subjectEntries = useMemo(
    () => taskSubjectEntries(automations, locale),
    [automations, locale],
  );
  const client = useConvexClient();
  const cancelWorkflowRun = useConvexAction(
    api.tasks.public_actions.cancelTaskWorkflow,
  );
  const { mutateAsync: cancelAgentRun } = useCancelTaskAgentRun();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingAssign | null>(null);
  const [pendingLiveRun, setPendingLiveRun] = useState<
    'automation' | 'agent' | null
  >(null);
  const [handoffBusy, setHandoffBusy] = useState(false);

  const resolved =
    assigneeType && assigneeId ? resolveActor(assigneeType, assigneeId) : null;

  const assignedAgent =
    assigneeType === 'agent' && assigneeId
      ? agents.find((a) => a.id === assigneeId)
      : undefined;

  // Only when the caller supplied task context (modal) — compact board/list
  // pickers omit these props and must stay a single avatar control.
  const hasTaskContext =
    taskTitle !== undefined ||
    taskDescription !== undefined ||
    taskLabels !== undefined;
  const showNonCodeWarning =
    hasTaskContext &&
    assignedAgent?.displayCategory === 'coding-agent' &&
    !looksLikeCodeTask({
      title: taskTitle,
      description: taskDescription,
      labels: taskLabels,
    });

  const sectionInfoButton = useCallback(
    (content: string): ReactNode => (
      <Tooltip content={content} side="right">
        <button
          type="button"
          aria-label={tCommon('aria.moreInfo')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex rounded align-middle focus-visible:ring-1 focus-visible:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
    ),
    [tCommon],
  );

  const label = resolved?.name ?? t('assignee.unassigned');

  const avatar = (
    <AssigneeAvatar
      assigneeType={assigneeType}
      assigneeId={assigneeId}
      name={resolved?.name}
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
      agent: (typeof agents)[number],
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
          client.query(api.automations.queries.getLiveRunForTask, {
            organizationId,
            projectId,
            taskId,
          }),
          client.query(api.tasks.queries.getLatestTaskAgentRunForTask, {
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
      console.error('[tasks] handoff cancel-then-reassign failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    } finally {
      setHandoffBusy(false);
    }
  };

  const handleSelect = (val: string) => {
    if (val.startsWith('__section:')) return;
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
      onOpenChange={setOpen}
      align={align}
      modal
      trigger={trigger}
      searchPlaceholder={t('assignee.search')}
      emptyText={tCommon('search.noResults')}
      aria-label={t('fields.assignee')}
      optionAction={(opt) => {
        if (opt.isSectionHeader) return null;
        const parsed = parseOptionValue(opt.value);
        return (
          <AssigneeAvatar
            assigneeType={parsed.type}
            assigneeId={parsed.id}
            name={opt.label}
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
            {t('assignee.liveAgentsOnly')}
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

  const triggerRow = (
    <Tooltip content={label}>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary */}
      <span
        className="inline-flex max-w-full min-w-0 items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {select}
        {afterTrigger}
        {handoffDialog}
      </span>
    </Tooltip>
  );

  if (!showNonCodeWarning) {
    return triggerRow;
  }

  // Full-width under the avatar row — never beside it. The task-modal side
  // panel is a constrained flex column that shrinks PropertyField rows to
  // min-h-7; a tall warning inlined next to the avatar overflowed and
  // painted over Status/Priority/Due date.
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary
    <span
      className="flex w-full min-w-0 flex-col gap-1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {triggerRow}
      <Text variant="muted" className="text-xs text-pretty">
        {t('assignee.nonCodeWarning')}
      </Text>
    </span>
  );
}
