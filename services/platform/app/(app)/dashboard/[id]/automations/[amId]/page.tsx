'use client';

import { useParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import dynamic from 'next/dynamic';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Skeleton } from '@/components/ui/skeleton';
import { Stack, Center } from '@/components/ui/layout';

// Dynamically import AutomationSteps to code-split ReactFlow (~200KB)
const AutomationSteps = dynamic(
  () =>
    import('../components/automation-steps').then((mod) => mod.AutomationSteps),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-stretch size-full flex-1 max-h-full">
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
          <Center className="absolute inset-0">
            <Stack gap={4} className="w-full max-w-sm text-center">
              <Skeleton className="h-20 w-72 mx-auto rounded-lg" />
              <Skeleton className="h-4 w-48 mx-auto" />
            </Stack>
          </Center>
          {/* MiniMap placeholder */}
          <div className="absolute bottom-4 right-4">
            <Skeleton className="h-32 w-48 rounded-lg" />
          </div>
          {/* Toolbar placeholder */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        </div>
      </div>
    ),
  },
);

export default function AutomationStepsPage() {
  const params = useParams();
  const organizationId = typeof params?.id === 'string' ? params.id : '';
  const amId =
    typeof params?.amId === 'string'
      ? (params.amId as Id<'wfDefinitions'>)
      : undefined;

  const steps = useQuery(
    api.wf_step_defs.getWorkflowStepsPublic,
    amId ? { wfDefinitionId: amId } : 'skip',
  );
  const automation = useQuery(
    api.wf_definitions.getWorkflowPublic,
    amId ? { wfDefinitionId: amId } : 'skip',
  );

  if (!amId) {
    return null;
  }

  // Validate automation status is one of the expected values
  const validStatuses = ['draft', 'active', 'inactive', 'archived'] as const;
  const status = validStatuses.includes(
    automation?.status as (typeof validStatuses)[number],
  )
    ? (automation?.status as (typeof validStatuses)[number])
    : 'draft';

  return (
    <AutomationSteps
      status={status}
      className="flex-1"
      steps={steps || []}
      organizationId={organizationId}
      automationId={amId}
    />
  );
}
