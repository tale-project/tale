import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { AutomationRoot } from '@/lib/collections/entities/automation-roots';
import type { WfAutomation } from '@/lib/collections/entities/wf-automations';
import type { WfStep } from '@/lib/collections/entities/wf-steps';

import { createAutomationRootsCollection } from '@/lib/collections/entities/automation-roots';
import { createWfAutomationsCollection } from '@/lib/collections/entities/wf-automations';
import { createWfStepsCollection } from '@/lib/collections/entities/wf-steps';
import { useCollection } from '@/lib/collections/use-collection';

export function useAutomationRootCollection(organizationId: string) {
  return useCollection(
    'automation-roots',
    createAutomationRootsCollection,
    organizationId,
  );
}

export function useWfAutomationCollection(organizationId: string) {
  return useCollection(
    'wf-automations',
    createWfAutomationsCollection,
    organizationId,
  );
}

export function useWorkflowStepCollection(wfDefinitionId: string) {
  return useCollection('wf-steps', createWfStepsCollection, wfDefinitionId);
}

export function useAutomationRoots(
  collection: Collection<AutomationRoot, string>,
) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ root: collection }).select(({ root }) => root),
  );

  return {
    automationRoots: data,
    isLoading,
  };
}

export function useAutomations(collection: Collection<WfAutomation, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ automation: collection }).select(({ automation }) => automation),
  );

  return {
    automations: data,
    isLoading,
  };
}

export function useWorkflowSteps(collection: Collection<WfStep, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ step: collection }).select(({ step }) => step),
  );

  return {
    steps: data,
    isLoading,
  };
}

export type { AutomationRoot };
