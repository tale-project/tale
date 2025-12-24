'use client';

import { useParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import dynamic from 'next/dynamic';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Skeleton } from '@/components/ui/skeleton';

// Dynamically import AutomationSteps to code-split ReactFlow (~200KB)
const AutomationSteps = dynamic(
  () =>
    import('../components/automation-steps').then((mod) => mod.AutomationSteps),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-stretch size-full flex-1 max-h-[calc(100%-6rem)]">
        <div className="flex-[1_1_0] min-h-0 bg-background relative">
          {/* Background dots pattern - matches ReactFlow */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(circle, hsl(var(--muted-foreground)) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
          {/* Center loading placeholder */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="space-y-4 w-full max-w-sm text-center">
              <Skeleton className="h-20 w-72 mx-auto rounded-lg" />
              <Skeleton className="h-4 w-48 mx-auto" />
            </div>
          </div>
          {/* MiniMap placeholder */}
          <div className="absolute bottom-4 right-4">
            <Skeleton className="h-32 w-48 rounded-lg" />
          </div>
          {/* Toolbar placeholder */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
        </div>
      </div>
    ),
  },
);

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
