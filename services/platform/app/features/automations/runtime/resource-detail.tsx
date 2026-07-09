'use client';

/**
 * The automation shell's generic resource-detail overlay — the target of an
 * `onSuccess: { kind: 'openDetail' }` action effect. Keyed by a polymorphic
 * `(subjectType, id)`, one overlay instance lives at the automation shell;
 * `useResourceDetail().open({...})` drives it.
 *
 * Composition per subject:
 * - `task` — the full desk detail: a `DetailPanel` (fields via
 *   `tasks/queries:getTask`), the subject's workflow run (`SubjectRun`), the
 *   task's activity timeline (`tasks/queries:listTaskActivity`), and an
 *   `AgentChat` with the automation's `implementer` role on the shared
 *   `('task', id)` thread. The two task queries run through `useBoundQuery`,
 *   so they must be in the hosting automation's `capabilities.functions` allowlist
 *   (a task-based automation's manifest carries them); a non-allowlisting automation degrades to
 *   the blocked notice, and an unmapped `implementer` role degrades inside
 *   `AgentChat` itself.
 * - anything else — the resource's workflow run via the reused `SubjectRun`,
 *   unchanged.
 *
 * Section labels are PLATFORM i18n strings (`automations.detail.*`,
 * `tasks.fields.*`) — the per-bundle label catalog has been retired, so the
 * platform owns all UI translations.
 *
 * Mounted inside `AutomationRuntimeProvider` (so the composed blocks resolve the
 * org/allowlist/labels from context); the Radix portal keeps the React tree,
 * so context still flows.
 */
import { Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { Activity, History } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { isTaskStatus, TASK_ACTIVITY_LABEL_KEY } from '../../tasks/lib/display';
import { useBoundQuery } from '../hooks/use-bound-query';
import { BindingStates, BlockFrame } from '../registry/block-frame';
import { AgentChat } from '../registry/connected/agent-chat';
import { DetailPanel } from '../registry/connected/detail-panel';
import { SubjectRun } from '../registry/connected/subject-run';

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
function TaskActivitySection({ taskId }: { taskId: string }) {
  const { t } = useT('automations');
  const { t: tTasks } = useT('tasks');
  const { formatDate, formatRelative } = useFormatDate();
  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    TASK_ACTIVITY_PATH,
    { taskId, organizationId: '$orgId' },
  );
  const rows = Array.isArray(data) ? data.filter(isRecord) : [];

  return (
    <BlockFrame title={t('detail.activity')} icon={History}>
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
    </BlockFrame>
  );
}

/** The composed task detail (see the file header for the section contract). */
function TaskDetailSections({ target }: { target: ResourceDetailTarget }) {
  const { t } = useT('automations');
  const { t: tTasks } = useT('tasks');
  return (
    <Stack gap={4}>
      <DetailPanel
        query={{
          path: 'tasks/queries:getTask',
          args: { taskId: target.id, organizationId: '$orgId' },
        }}
        fields={[
          { labelKey: tTasks('fields.title'), field: 'task.title' },
          { labelKey: tTasks('fields.id'), field: 'task.number' },
          {
            labelKey: tTasks('fields.status'),
            field: 'task.status',
            kind: 'badge',
          },
          {
            labelKey: tTasks('fields.priority'),
            field: 'task.priority',
            kind: 'badge',
          },
          {
            labelKey: t('detail.openLink'),
            field: 'task.externalUrl',
            kind: 'link',
          },
        ]}
      />
      <BlockFrame title={t('detail.run')} icon={Activity}>
        <SubjectRun subjectType={target.subjectType} subjectId={target.id} />
      </BlockFrame>
      <TaskActivitySection taskId={target.id} />
      <AgentChat
        title={t('detail.discuss')}
        roleToken="implementer"
        subject={{ type: 'task', id: target.id }}
        placeholder={t('detail.chatPlaceholder')}
        height={360}
      />
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
