import { convexQuery } from '@convex-dev/react-query';
import {
  createFileRoute,
  Outlet,
  useLocation,
  Link,
} from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { Doc } from '@/convex/_generated/dataModel';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Input } from '@/app/components/ui/forms/input';
import { Center } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { AutomationNavigation } from '@/app/features/automations/components/automation-navigation';
import { useUpdateAutomation } from '@/app/features/automations/hooks/mutations';
import {
  useWorkflow,
  useWorkflowSteps,
  useListWorkflowVersions,
} from '@/app/features/automations/hooks/queries';
import { useAutomationVersionNavigation } from '@/app/features/automations/hooks/use-automation-version-navigation';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';

const AutomationSteps = lazy(() =>
  import('@/app/features/automations/components/automation-steps').then(
    (mod) => ({
      default: mod.AutomationSteps,
    }),
  ),
);

const searchSchema = z.object({
  panel: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/automations/$amId')({
  head: () => ({
    meta: seo('automation'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.wf_definitions.queries.getWorkflow, {
        wfDefinitionId: toId<'wfDefinitions'>(params.amId),
      }),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.wf_step_defs.queries.getWorkflowSteps, {
        wfDefinitionId: toId<'wfDefinitions'>(params.amId),
      }),
    );
  },
  component: AutomationDetailLayout,
});

function StepCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-[18.75rem] rounded-lg border border-border bg-card shadow-sm',
        className,
      )}
    >
      <div className="flex gap-3 px-2.5 py-2">
        <Skeleton className="size-5 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-2.5 w-40" />
        </div>
        <Skeleton className="h-4 w-10 rounded-full" />
      </div>
    </div>
  );
}

function ConnectorLine() {
  return (
    <div className="border-muted-foreground/30 mx-auto h-8 w-0 border-l-2" />
  );
}

function AutomationStepsSkeleton() {
  return (
    <div className="flex size-full max-h-full flex-1 justify-stretch">
      <div className="bg-background relative min-h-0 flex-[1_1_0]">
        {/* Dot grid background */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--muted-foreground)) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Workflow step cards */}
        <Center className="absolute inset-0">
          <div className="flex flex-col items-center">
            <StepCardSkeleton />
            <ConnectorLine />
            <StepCardSkeleton />
            <ConnectorLine />
            <StepCardSkeleton />
          </div>
        </Center>

        {/* Minimap skeleton */}
        <div className="absolute right-4 bottom-4">
          <Skeleton className="h-[128px] w-[192px] rounded-lg" />
        </div>

        {/* Toolbar skeleton */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="ring-border bg-background flex items-center gap-2 rounded-lg p-1 shadow-sm ring-1">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AutomationDetailLayout() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = toId<'wfDefinitions'>(amId);
  const location = useLocation();
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { user } = useAuth();
  const { navigateToVersion } = useAutomationVersionNavigation(
    organizationId,
    amId,
  );

  const [editMode, setEditMode] = useState(false);
  const { register, getValues } = useForm<{ name: string }>();
  const { mutateAsync: updateWorkflow, isPending: isUpdating } =
    useUpdateAutomation();

  const { data: automation, isLoading: isLoadingAutomation } =
    useWorkflow(automationId);
  const { steps, isLoading: isLoadingSteps } = useWorkflowSteps(amId);
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const isLoading = isLoadingAutomation || isLoadingSteps;
  const { data: versions } = useListWorkflowVersions(
    organizationId,
    automation?.name,
  );

  const handleSubmitAutomationName = async () => {
    if (isUpdating) return;
    if (automation?.name === getValues().name || !getValues().name) {
      setEditMode(false);
      return;
    }
    if (!user?.userId) {
      setEditMode(false);
      return;
    }
    const values = getValues();
    try {
      await updateWorkflow({
        wfDefinitionId: automationId,
        updates: { name: values.name },
        updatedBy: user.userId,
      });
      setEditMode(false);
    } catch {
      toast({
        title: tCommon('errors.somethingWentWrong'),
        variant: 'destructive',
      });
      setEditMode(false);
    }
  };

  const validStatuses = ['draft', 'active', 'inactive', 'archived'] as const;
  type ValidStatus = (typeof validStatuses)[number];
  const status: ValidStatus =
    validStatuses.find((s) => s === automation?.status) ?? 'draft';

  const isExactAutomationPage =
    location.pathname === `/dashboard/${organizationId}/automations/${amId}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false} className="gap-2">
          <h1 className="truncate text-base font-semibold">
            <Link
              to="/dashboard/$id/automations"
              params={{ id: organizationId }}
              className="text-muted-foreground hidden cursor-pointer md:inline"
            >
              {t('title')}&nbsp;&nbsp;
            </Link>
            {!isLoading && automation?.name && !editMode && (
              <button
                type="button"
                className="text-foreground font-inherit cursor-pointer appearance-none border-none bg-transparent p-0"
                onClick={() => setEditMode(true)}
              >
                <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                {automation.name}
              </button>
            )}
            {isLoading && (
              <>
                <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              </>
            )}
          </h1>
          {editMode && (
            <Input
              {...register('name')}
              defaultValue={automation?.name ?? ''}
              autoFocus
              className="h-6 w-fit text-sm"
              onBlur={handleSubmitAutomationName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleSubmitAutomationName();
                }
                if (e.key === 'Escape') {
                  setEditMode(false);
                }
              }}
            />
          )}
          {isLoading && <Skeleton className="ml-2 h-5 w-14 rounded-full" />}
          {!isLoading && automation?.status === 'draft' && (
            <Badge variant="outline" className="ml-2">
              {tCommon('status.draft')}
            </Badge>
          )}
          {!isLoading && automation?.status === 'active' && (
            <Badge variant="green" className="ml-2">
              {tCommon('status.active')}
            </Badge>
          )}
          {!isLoading && automation?.status === 'archived' && (
            <Badge variant="outline" className="ml-2">
              {tCommon('status.archived')}
            </Badge>
          )}

          {automation && versions && versions.length > 0 && (
            <DropdownMenu
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-8 text-sm md:hidden"
                >
                  {`v${automation.versionNumber}`}
                  <ChevronDown className="ml-1 size-3" aria-hidden="true" />
                </Button>
              }
              items={[
                versions.map(
                  (version: Doc<'wfDefinitions'>): DropdownMenuItem => ({
                    type: 'item' as const,
                    label: (
                      <>
                        <span>{`v${version.versionNumber}`}</span>
                        <span className="text-muted-foreground ml-1 text-xs">
                          {version.status === 'draft' &&
                            tCommon('status.draft')}
                          {version.status === 'active' &&
                            tCommon('status.active')}
                          {version.status === 'archived' &&
                            tCommon('status.archived')}
                        </span>
                      </>
                    ),
                    onClick: () => navigateToVersion(version._id),
                  }),
                ),
              ]}
              align="end"
              contentClassName="w-40"
            />
          )}
        </AdaptiveHeaderRoot>
        <AutomationNavigation
          organizationId={organizationId}
          automationId={amId}
          automation={automation}
          userRole={memberContext?.role ?? 'Member'}
          isLoading={isLoading}
        />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        {isExactAutomationPage ? (
          isLoading ? (
            <AutomationStepsSkeleton />
          ) : (
            <Suspense fallback={<AutomationStepsSkeleton />}>
              <AutomationSteps
                status={status}
                className="flex-1"
                steps={steps || []}
                organizationId={organizationId}
                automationId={automationId}
              />
            </Suspense>
          )
        ) : (
          <Outlet />
        )}
      </LayoutErrorBoundary>
    </div>
  );
}
