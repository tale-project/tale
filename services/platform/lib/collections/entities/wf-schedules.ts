import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type WfSchedule = ConvexItemOf<
  typeof api.workflows.triggers.queries.getSchedules
>;

export const createWfSchedulesCollection: CollectionFactory<
  WfSchedule,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'wf-schedules',
    queryFn: api.workflows.triggers.queries.getSchedules,
    args: { workflowRootId: toId<'wfDefinitions'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(
            api.workflows.triggers.mutations.createSchedule,
            {
              organizationId: m.modified.organizationId,
              workflowRootId: toId<'wfDefinitions'>(m.modified.workflowRootId),
              cronExpression: m.modified.cronExpression,
              timezone: m.modified.timezone,
            },
          ),
        ),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          if ('isActive' in m.changes && m.changes.isActive !== undefined) {
            await convexClient.mutation(
              api.workflows.triggers.mutations.toggleSchedule,
              {
                scheduleId: toId<'wfSchedules'>(m.key),
                isActive: m.changes.isActive,
              },
            );
          }
          const {
            _id,
            _creationTime,
            organizationId: _org,
            workflowRootId: _root,
            isActive: _active,
            createdAt: _at,
            createdBy: _by,
            lastTriggeredAt: _lt,
            ...updateFields
          } = m.changes;
          if (Object.keys(updateFields).length > 0) {
            await convexClient.mutation(
              api.workflows.triggers.mutations.updateSchedule,
              {
                scheduleId: toId<'wfSchedules'>(m.key),
                ...updateFields,
              },
            );
          }
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(
            api.workflows.triggers.mutations.deleteSchedule,
            {
              scheduleId: toId<'wfSchedules'>(m.key),
            },
          ),
        ),
      );
    },
  });

export type { WfSchedule };
