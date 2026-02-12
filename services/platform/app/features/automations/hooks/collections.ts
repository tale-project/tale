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
