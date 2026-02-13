import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { WfEventSubscription } from '@/lib/collections/entities/wf-event-subscriptions';
import type { WfSchedule } from '@/lib/collections/entities/wf-schedules';
import type { WfWebhook } from '@/lib/collections/entities/wf-webhooks';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export function useCreateWebhook() {
  return useConvexMutation(api.workflows.triggers.mutations.createWebhook);
}

export function useCreateSchedule(collection: Collection<WfSchedule, string>) {
  return useCallback(
    async (args: {
      organizationId: string;
      workflowRootId: string;
      cronExpression: string;
      timezone: string;
    }) => {
      const tx = collection.insert(
        {
          _id: toId<'wfSchedules'>(`temp-${crypto.randomUUID()}`),
          _creationTime: 0,
          organizationId: args.organizationId,
          workflowRootId: toId<'wfDefinitions'>(args.workflowRootId),
          cronExpression: args.cronExpression,
          timezone: args.timezone,
          isActive: true,
          createdAt: Date.now(),
          createdBy: '',
        },
        { optimistic: false },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateSchedule(collection: Collection<WfSchedule, string>) {
  return useCallback(
    async (args: {
      scheduleId: string;
      cronExpression?: string;
      timezone?: string;
    }) => {
      const tx = collection.update(args.scheduleId, (draft) => {
        if (args.cronExpression !== undefined)
          draft.cronExpression = args.cronExpression;
        if (args.timezone !== undefined) draft.timezone = args.timezone;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useToggleSchedule(collection: Collection<WfSchedule, string>) {
  return useCallback(
    async (args: { scheduleId: string; isActive: boolean }) => {
      const tx = collection.update(args.scheduleId, (draft) => {
        draft.isActive = args.isActive;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteSchedule(collection: Collection<WfSchedule, string>) {
  return useCallback(
    async (args: { scheduleId: string }) => {
      const tx = collection.delete(args.scheduleId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useToggleWebhook(collection: Collection<WfWebhook, string>) {
  return useCallback(
    async (args: { webhookId: string; isActive: boolean }) => {
      const tx = collection.update(args.webhookId, (draft) => {
        draft.isActive = args.isActive;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteWebhook(collection: Collection<WfWebhook, string>) {
  return useCallback(
    async (args: { webhookId: string }) => {
      const tx = collection.delete(args.webhookId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useCreateEventSubscription(
  collection: Collection<WfEventSubscription, string>,
) {
  return useCallback(
    async (args: {
      organizationId: string;
      workflowRootId: string;
      eventType: string;
      eventFilter?: Record<string, string>;
    }) => {
      const tx = collection.insert(
        {
          _id: toId<'wfEventSubscriptions'>(`temp-${crypto.randomUUID()}`),
          _creationTime: 0,
          organizationId: args.organizationId,
          workflowRootId: toId<'wfDefinitions'>(args.workflowRootId),
          eventType: args.eventType,
          eventFilter: args.eventFilter,
          isActive: true,
          createdAt: Date.now(),
          createdBy: '',
        },
        { optimistic: false },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateEventSubscription(
  collection: Collection<WfEventSubscription, string>,
) {
  return useCallback(
    async (args: {
      subscriptionId: string;
      eventFilter?: Record<string, string>;
    }) => {
      const tx = collection.update(args.subscriptionId, (draft) => {
        draft.eventFilter = args.eventFilter;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useToggleEventSubscription(
  collection: Collection<WfEventSubscription, string>,
) {
  return useCallback(
    async (args: { subscriptionId: string; isActive: boolean }) => {
      const tx = collection.update(args.subscriptionId, (draft) => {
        draft.isActive = args.isActive;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteEventSubscription(
  collection: Collection<WfEventSubscription, string>,
) {
  return useCallback(
    async (args: { subscriptionId: string }) => {
      const tx = collection.delete(args.subscriptionId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
