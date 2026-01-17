import { createFileRoute, Outlet, useLocation, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { lazy, Suspense, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, Center } from '@/app/components/ui/layout/layout';
import { Input } from '@/app/components/ui/forms/input';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Button } from '@/app/components/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/overlays/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AutomationNavigation } from '@/app/features/automations/components/automation-navigation';
import { useUpdateAutomation } from '@/app/features/automations/hooks/use-update-automation';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

const AutomationSteps = lazy(() =>
  import('@/app/features/automations/components/automation-steps').then((mod) => ({
    default: mod.AutomationSteps,
  })),
);

export const Route = createFileRoute('/dashboard/$id/automations/$amId')({
  component: AutomationDetailLayout,
});

function AutomationStepsSkeleton() {
  return (
    <div className="flex justify-stretch size-full flex-1 max-h-full">
      <div className="flex-[1_1_0] min-h-0 bg-background relative">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--muted-foreground)) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        <Center className="absolute inset-0">
          <Stack gap={4} className="w-full max-w-sm text-center">
            <Skeleton className="h-20 w-72 mx-auto rounded-lg" />
            <Skeleton className="h-4 w-48 mx-auto" />
          </Stack>
        </Center>
        <div className="absolute bottom-4 right-4">
          <Skeleton className="h-32 w-48 rounded-lg" />
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function AutomationDetailLayout() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = amId as Id<'wfDefinitions'>;
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { user } = useAuth();

  const [editMode, setEditMode] = useState(false);
  const isSubmittingRef = useRef(false);
  const { register, getValues } = useForm<{ name: string }>();
  const updateWorkflow = useUpdateAutomation();

  const automation = useQuery(api.wf_definitions.queries.getWorkflow.getWorkflowPublic, {
    wfDefinitionId: automationId,
  });
  const steps = useQuery(api.wf_step_defs.getWorkflowStepsPublic, {
    wfDefinitionId: automationId,
  });
  const memberContext = useQuery(api.queries.member.getCurrentMemberContext, {
    organizationId,
  });

  const versions = useQuery(
    api.wf_definitions.listVersionsPublic,
    automation?.name && organizationId
      ? {
          organizationId,
          name: automation.name,
        }
      : 'skip',
  );

  const handleVersionChange = (versionId: string) => {
    navigate({
      to: '/dashboard/$id/automations/$amId',
      params: { id: organizationId, amId: versionId },
      search: { panel: 'ai-chat' },
    });
  };

  const handleSubmitAutomationName = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    if (automation?.name === getValues().name || !getValues().name) {
      setEditMode(false);
      isSubmittingRef.current = false;
      return;
    }
    if (!user?._id) {
      setEditMode(false);
      isSubmittingRef.current = false;
      return;
    }
    const values = getValues();
    await updateWorkflow({
      wfDefinitionId: automationId,
      updates: { name: values.name },
      updatedBy: user._id,
    });
    setEditMode(false);
    isSubmittingRef.current = false;
  };

  const validStatuses = ['draft', 'active', 'inactive', 'archived'] as const;
  const status = validStatuses.includes(
    automation?.status as (typeof validStatuses)[number],
  )
    ? (automation?.status as (typeof validStatuses)[number])
    : 'draft';

  const isExactAutomationPage =
    location.pathname === `/dashboard/${organizationId}/automations/${amId}`;

  return (
    <>
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false} showBorder className="gap-2">
          <h1 className="text-base font-semibold truncate">
            <Link
              to="/dashboard/$id/automations"
              params={{ id: organizationId }}
              className={cn(
                'hidden md:inline text-foreground',
                automation?.name && 'text-muted-foreground cursor-pointer',
              )}
            >
              {t('title')}&nbsp;&nbsp;
            </Link>
            {automation?.name && !editMode && (
              <span
                role="button"
                tabIndex={0}
                className="text-foreground cursor-pointer"
                onClick={() => setEditMode(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditMode(true);
                  }
                }}
              >
                <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                {automation?.name}
              </span>
            )}
          </h1>
          {editMode && (
            <Input
              {...register('name')}
              defaultValue={automation?.name ?? ''}
              autoFocus
              className="w-fit h-6 text-sm"
              onBlur={handleSubmitAutomationName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmitAutomationName();
                }
                if (e.key === 'Escape') {
                  setEditMode(false);
                }
              }}
            />
          )}
          {automation?.status === 'draft' && (
            <Badge variant="outline" className="ml-2">
              {tCommon('status.draft')}
            </Badge>
          )}
          {automation?.status === 'active' && (
            <Badge variant="green" className="ml-2">
              {tCommon('status.active')}
            </Badge>
          )}
          {automation?.status === 'archived' && (
            <Badge variant="outline" className="ml-2">
              {tCommon('status.archived')}
            </Badge>
          )}

          {automation && versions && versions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="md:hidden ml-auto text-sm h-8"
                >
                  {automation.version}
                  <ChevronDown className="ml-1 size-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {versions.map((version) => (
                  <DropdownMenuItem
                    key={version._id}
                    onClick={() => handleVersionChange(version._id)}
                  >
                    <span>{version.version}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      {version.status === 'draft' && tCommon('status.draft')}
                      {version.status === 'active' && tCommon('status.active')}
                      {version.status === 'archived' &&
                        tCommon('status.archived')}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </AdaptiveHeaderRoot>
        <AutomationNavigation
          organizationId={organizationId}
          automationId={amId}
          automation={automation}
          userRole={memberContext?.member?.role ?? 'Member'}
        />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        {isExactAutomationPage ? (
          <Suspense fallback={<AutomationStepsSkeleton />}>
            <AutomationSteps
              status={status}
              className="flex-1"
              steps={steps || []}
              organizationId={organizationId}
              automationId={automationId}
            />
          </Suspense>
        ) : (
          <Outlet />
        )}
      </LayoutErrorBoundary>
    </>
  );
}
