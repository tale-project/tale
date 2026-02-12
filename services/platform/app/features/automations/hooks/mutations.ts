import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { WfAutomation } from '@/lib/collections/entities/wf-automations';
import type { WfStep } from '@/lib/collections/entities/wf-steps';

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
