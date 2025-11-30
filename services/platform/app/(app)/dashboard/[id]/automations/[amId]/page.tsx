'use client';

import { useParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';

import { AutomationSteps } from '../components/automation-steps';

export default function AutomationStepsPage() {
  const params = useParams();
  const organizationId = params?.id as string;
  const amId = params?.amId as Id<'wfDefinitions'>;
  const steps = useQuery(
    api.wf_step_defs.getWorkflowStepsPublic,
    amId ? { wfDefinitionId: amId } : 'skip',
  );
  const automation = useQuery(
    api.wf_definitions.getWorkflowPublic,
    amId ? { wfDefinitionId: amId } : 'skip',
  );

  // Handle step creation to refresh the steps
  const handleStepCreated = () => {
    // The useQuery hook will automatically refetch when the data changes
    // due to Convex's real-time updates, so we don't need to do anything here
  };

  return (
    <AutomationSteps
      status={
        (automation?.status as 'draft' | 'active' | 'inactive' | 'archived') ??
        'draft'
      }
      className="flex-1"
      steps={steps || []}
      organizationId={organizationId}
      automationId={amId}
      onStepCreated={handleStepCreated}
    />
  );
}
