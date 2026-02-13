import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { WfAutomation } from '@/lib/collections/entities/wf-automations';
import type { WfStep } from '@/lib/collections/entities/wf-steps';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

export function useStartWorkflow() {
  return useConvexMutation(api.workflow_engine.mutations.startWorkflow);
}

export function useCreateAutomation() {
  return useConvexMutation(
    api.wf_definitions.mutations.createWorkflowWithSteps,
  );
}

export function useDuplicateAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.duplicateWorkflow);
}

export function usePublishAutomationDraft() {
  return useConvexMutation(api.wf_definitions.mutations.publishDraft);
}

export function useUnpublishAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.unpublishWorkflow);
}

export function useRepublishAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.republishWorkflow);
}

export function useCreateDraftFromActive() {
  return useConvexMutation(api.wf_definitions.mutations.createDraftFromActive);
}

export function useCreateStep(collection: Collection<WfStep, string>) {
  return useCallback(
    async (args: {
      wfDefinitionId: string;
      stepSlug: string;
      name: string;
      stepType: WfStep['stepType'];
      order: number;
      config: WfStep['config'];
      nextSteps: Record<string, string>;
      editMode?: string;
    }) => {
      const tx = collection.insert(
        {
          _id: toId<'wfStepDefs'>(`temp-${crypto.randomUUID()}`),
          _creationTime: 0,
          organizationId: '',
          wfDefinitionId: toId<'wfDefinitions'>(args.wfDefinitionId),
          stepSlug: args.stepSlug,
          name: args.name,
          stepType: args.stepType,
          order: args.order,
          config: args.config,
          nextSteps: args.nextSteps,
        },
        {
          optimistic: false,
          metadata: { editMode: args.editMode ?? 'visual' },
        },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateStep(collection: Collection<WfStep, string>) {
  return useCallback(
    async (args: {
      stepRecordId: string;
      updates: Record<string, unknown>;
      editMode?: string;
    }) => {
      const tx = collection.update(
        args.stepRecordId,
        { metadata: { editMode: args.editMode ?? 'visual' } },
        (draft) => {
          Object.assign(draft, args.updates);
        },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateAutomation(
  collection: Collection<WfAutomation, string>,
) {
  return useCallback(
    async (args: {
      wfDefinitionId: string;
      updates: Record<string, unknown>;
      updatedBy: string;
    }) => {
      const tx = collection.update(
        args.wfDefinitionId,
        { metadata: { updatedBy: args.updatedBy } },
        (draft) => {
          Object.assign(draft, args.updates);
        },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteAutomation(
  collection: Collection<WfAutomation, string>,
) {
  return useCallback(
    async (args: { wfDefinitionId: string }) => {
      const tx = collection.delete(args.wfDefinitionId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateAutomationMetadata(
  collection: Collection<WfAutomation, string>,
) {
  return useCallback(
    async (args: {
      wfDefinitionId: string;
      metadata: Record<string, unknown>;
      updatedBy: string;
    }) => {
      const tx = collection.update(
        args.wfDefinitionId,
        { metadata: { updatedBy: args.updatedBy, metadataOnly: true } },
        (draft) => {
          draft.metadata = args.metadata;
        },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
