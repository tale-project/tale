'use client';

/**
 * The automation shell's generic resource-detail overlay — the target of an
 * `onSuccess: { kind: 'openDetail' }` action effect. Keyed by a polymorphic
 * `(subjectType, id)`, one overlay instance lives at the automation shell;
 * `useResourceDetail().open({...})` drives it.
 *
 * Composition per task subject (four peer blocks):
 * 1. Status + human-gate actions (Request changes / Mark done)
 * 2. Input — title + folder refs
 * 3. Outcome (+ Run details collapsed) via `SubjectRun` / OperatorView
 * 4. Details — activity, comments, optional implementer chat
 *
 * Section labels are PLATFORM i18n strings (`automations.detail.*`,
 * `tasks.fields.*`) — the per-bundle label catalog has been retired, so the
 * platform owns all UI translations.
 *
 * Mounted inside `AutomationRuntimeProvider` (so the composed blocks resolve the
 * org/allowlist/labels from context); the Radix portal keeps the React tree,
 * so context still flows.
 */
import { Card } from '@tale/ui/card';
import { HStack, Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { History, Inbox, ListTree } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useFormatDate } from '@/app/hooks/use-format-date';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { TaskComments } from '../../tasks/components/task-comments';
import { TaskStatusBadge } from '../../tasks/components/task-status-badge';
import { useTask } from '../../tasks/hooks/queries';
import { isTaskStatus, TASK_ACTIVITY_LABEL_KEY } from '../../tasks/lib/display';
import { useBoundQuery } from '../hooks/use-bound-query';
import { BindingStates, BlockFrame } from '../registry/block-frame';
import { AgentChat } from '../registry/connected/agent-chat';
import { BoundButton } from '../registry/connected/bound-button';
import { SubjectRun } from '../registry/connected/subject-run';
import { useAutomationRuntime } from './automation-runtime';
import { RequestChangesButton } from './request-changes-button';
import { TaskInputRefs } from './task-input-refs';

export interface ResourceDetailTarget {
  subjectType: string;
  id: string;
  /** Optional dialog title; falls back to a generic localized label. */
  title?: string;
}

interface ResourceDetailApi {
  open: (target: ResourceDetailTarget) => void;
}

// Stable no-op so a block used outside the provider (e.g. the operator run view)
// degrades silently rather than throwing — the effect just does nothing there.
const NOOP: ResourceDetailApi = { open: () => undefined };

const ResourceDetailContext = createContext<ResourceDetailApi | null>(null);

export function useResourceDetail(): ResourceDetailApi {
  return useContext(ResourceDetailContext) ?? NOOP;
}

const TASK_ACTIVITY_PATH = 'tasks/queries:listTaskActivity';

/**
 * The task's activity timeline — a minimal read of the platform activity rows
 * (action, from → to, when), matching the task modal's vocabulary: actions map
 * through `TASK_ACTIVITY_LABEL_KEY` into the `tasks` namespace and status
 * values localize via `tasks.status.*`; unknown values fall back to the raw
 * string so a new action degrades, not blanks.
 */
function TaskActivitySection({
  taskId,
  nested = false,
}: {
  taskId: string;
  /** When true, skip the outer BlockFrame (parent already frames Details). */
  nested?: boolean;
}) {
  const { t } = useT('automations');
  const { t: tTasks } = useT('tasks');
  const { formatDate, formatRelative } = useFormatDate();
  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    TASK_ACTIVITY_PATH,
    { taskId, organizationId: '$orgId' },
  );
  const rows = Array.isArray(data) ? data.filter(isRecord) : [];

  const body = (
    <BindingStates
      blocked={blocked}
      path={TASK_ACTIVITY_PATH}
      needsConfig={needsConfig}
      loading={isLoading && rows.length === 0}
    >
      {rows.length === 0 ? (
        <Text variant="muted">{t('binding.empty')}</Text>
      ) : (
        <Stack as="ul" gap={2}>
          {rows.map((row) => {
            const id = typeof row._id === 'string' ? row._id : undefined;
            const action = typeof row.action === 'string' ? row.action : '';
            const labelKey = TASK_ACTIVITY_LABEL_KEY[action];
            const label = labelKey ? tTasks(labelKey) : action;
            const localizeValue = (value: unknown): string | undefined => {
              if (typeof value !== 'string' || value === '') return undefined;
              return isTaskStatus(value) ? tTasks(`status.${value}`) : value;
            };
            const from = localizeValue(row.fromValue);
            const to = localizeValue(row.toValue);
            const detail = from && to ? `${from} → ${to}` : (to ?? from);
            const createdAt =
              typeof row.createdAt === 'number'
                ? new Date(row.createdAt)
                : undefined;
            return (
              <li
                key={id ?? `${action}-${String(row.createdAt)}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
              >
                <Text as="span" variant="body-sm">
                  {label}
                  {detail ? `: ${detail}` : ''}
                </Text>
                {createdAt && (
                  <Text as="span" variant="caption">
                    <time
                      dateTime={createdAt.toISOString()}
                      title={formatDate(createdAt, 'long')}
                    >
                      {formatRelative(createdAt)}
                    </time>
                  </Text>
                )}
              </li>
            );
          })}
        </Stack>
      )}
    </BindingStates>
  );

  if (nested) {
    return (
      <Stack gap={2}>
        <Text as="h3" className="font-medium">
          {t('detail.activity')}
        </Text>
        {body}
      </Stack>
    );
  }

  return (
    <BlockFrame title={t('detail.activity')} icon={History}>
      {body}
    </BlockFrame>
  );
}

/**
 * The task's comment thread — the SAME `task_discussion` surface the Tasks
 * board panel shows and the one workflow `task.list_comments` reads, so a
 * desk operator can leave feedback without leaving the automation view.
 * Access is user-level (RLS re-enforces server-side), mirroring `AgentChat`'s
 * direct-API precedent rather than the bundle capability allowlist.
 */
function TaskCommentsSection({ taskId }: { taskId: string }) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a task subject's target.id is a tasks Convex id (openDetail contract)
  const id = taskId as Id<'tasks'>;
  const { task, canComment } = useTask(id);
  const { data: me } = useCurrentMemberContext(task?.organizationId);
  if (!task) return null;
  return (
    <TaskComments
      taskId={task._id}
      organizationId={task.organizationId}
      projectId={task.projectId}
      canComment={canComment}
      currentUserId={me?.userId}
      isAdmin={me?.isAdmin}
    />
  );
}

/** The composed task detail (see the file header for the section contract). */
function TaskDetailSections({ target }: { target: ResourceDetailTarget }) {
  const { t } = useT('automations');
  // The chat section only exists when the automation actually casts an
  // implementer — an unmapped role here would just render a "role
  // unavailable" notice next to the comments section, which reads as noise
  // in a platform-composed dialog. (A pack-AUTHORED AgentChat block keeps
  // its explicit notice — the cast is that author's data to debug.)
  const { roles, automationSlug } = useAutomationRuntime();
  const implementerMapped = roles?.implementer !== undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- openDetail task id
  const { task } = useTask(target.id as Id<'tasks'>);
  const awaitingHuman = task?.status === 'in_review';
  const status = task && isTaskStatus(task.status) ? task.status : undefined;

  return (
    <Stack gap={4}>
      {/* 1. Compact status label (top-left) + human-gate actions (top-right) */}
      {task ? (
        <Card padding="none" shadow="sm">
          <Row gap={3} align="start" justify="between" className="p-4">
            <Stack gap={1} className="min-w-0 items-start">
              {status ? <TaskStatusBadge status={status} /> : null}
              {awaitingHuman ? (
                <Text variant="muted" className="text-sm">
                  {t('detail.awaitingHuman')}
                </Text>
              ) : null}
            </Stack>
            {awaitingHuman ? (
              <HStack gap={2} className="shrink-0">
                <RequestChangesButton
                  taskId={task._id}
                  organizationId={task.organizationId}
                  workflowSlug={automationSlug}
                />
                <BoundButton
                  action={{
                    labelKey: 'list.markDone',
                    path: 'tasks/mutations:updateTaskStatus',
                    mode: 'mutation',
                    variant: 'primary',
                    confirm: {
                      title: 'detail.markDoneConfirmTitle',
                      description: 'detail.markDoneConfirmDescription',
                    },
                    args: {
                      taskId: '$selected._id',
                      status: 'done',
                    },
                  }}
                  item={task}
                />
              </HStack>
            ) : null}
          </Row>
        </Card>
      ) : null}

      {/* 2. Input — what this case is */}
      <BlockFrame title={t('detail.input')} icon={Inbox}>
        {task ? (
          <Text as="p" className="font-medium">
            {task.title}
          </Text>
        ) : null}
        <TaskInputRefs taskId={target.id} />
      </BlockFrame>

      {/* 3. Outcome (+ Run details collapsed inside OperatorView) */}
      <SubjectRun subjectType={target.subjectType} subjectId={target.id} />

      {/* 4. Details — activity, comments, optional chat */}
      <BlockFrame title={t('detail.more')} icon={ListTree}>
        <Stack gap={4}>
          <TaskActivitySection taskId={target.id} nested />
          <TaskCommentsSection taskId={target.id} />
          {implementerMapped && (
            <AgentChat
              title={t('detail.discuss')}
              roleToken="implementer"
              subject={{ type: 'task', id: target.id }}
              placeholder={t('detail.chatPlaceholder')}
              height={360}
            />
          )}
        </Stack>
      </BlockFrame>
    </Stack>
  );
}

export function ResourceDetailProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useT('automations');
  const [target, setTarget] = useState<ResourceDetailTarget | null>(null);
  const open = useCallback((next: ResourceDetailTarget) => setTarget(next), []);
  const api = useMemo<ResourceDetailApi>(() => ({ open }), [open]);

  return (
    <ResourceDetailContext.Provider value={api}>
      {children}
      <ResponsiveDialog
        open={target !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setTarget(null);
        }}
      >
        {target && (
          <ResponsiveDialogContent
            className={
              // Pin height on desktop (task-modal pattern) so tall task detail
              // scrolls inside the body. Leaving overflow on the dialog itself
              // clips the last BlockFrame's border/shadow flush against the
              // bottom edge — the "truncated card" look. md: only: the mobile
              // drawer path already scrolls its own children wrapper.
              'max-w-3xl md:flex md:h-[85dvh] md:flex-col md:overflow-hidden'
            }
          >
            <ResponsiveDialogTitle className="shrink-0">
              {target.title ?? t('detail.title')}
            </ResponsiveDialogTitle>
            {/* pb keeps the last BlockFrame's border/shadow inside the
                scrollport — overflow clips anything that paints past the
                content box. */}
            <div className="mt-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:pb-3">
              {target.subjectType === 'task' ? (
                <TaskDetailSections target={target} />
              ) : (
                <SubjectRun
                  subjectType={target.subjectType}
                  subjectId={target.id}
                />
              )}
            </div>
          </ResponsiveDialogContent>
        )}
      </ResponsiveDialog>
    </ResourceDetailContext.Provider>
  );
}
