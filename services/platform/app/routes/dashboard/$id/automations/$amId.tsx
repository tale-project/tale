import {
  createFileRoute,
  Outlet,
  useLocation,
  Link,
} from '@tanstack/react-router';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { z } from 'zod';

import type { Doc } from '@/convex/_generated/dataModel';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Center } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { AutomationAIChatPanel } from '@/app/features/automations/components/automation-ai-chat-panel';
import { AutomationNavigation } from '@/app/features/automations/components/automation-navigation';
import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import {
  WorkflowConfigProvider,
  useWorkflowConfig,
} from '@/app/features/automations/hooks/use-workflow-config-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug, getSlugBaseName } from '@/lib/utils/workflow-slug';

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
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--muted-foreground)) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        <Center className="absolute inset-0">
          <div className="flex flex-col items-center">
            <StepCardSkeleton />
            <ConnectorLine />
            <StepCardSkeleton />
            <ConnectorLine />
            <StepCardSkeleton />
          </div>
        </Center>
        <div className="absolute right-4 bottom-4">
          <Skeleton className="h-[128px] w-[192px] rounded-lg" />
        </div>
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
  const workflowSlug = urlParamToSlug(amId);
  const { t } = useT('automations');

  const {
    data: readResult,
    isLoading,
    refetch,
  } = useReadWorkflow('default', workflowSlug);

  const config = useMemo(() => {
    if (!readResult || !readResult.ok) return undefined;
    return readResult.config;
  }, [readResult]);

  if (isLoading) {
    return (
      <PageLayout
        header={
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <Heading level={1} size="base" truncate>
              <Link
                to="/dashboard/$id/automations"
                params={{ id: organizationId }}
                className="text-muted-foreground hidden cursor-pointer md:inline"
              >
                {t('title')}&nbsp;&nbsp;
              </Link>
              <span className="hidden md:inline">/&nbsp;&nbsp;</span>
              <Skeleton className="inline-block h-4 w-32 align-middle" />
            </Heading>
          </AdaptiveHeaderRoot>
        }
        organizationId={organizationId}
      >
        <AutomationStepsSkeleton />
      </PageLayout>
    );
  }

  if (!config) {
    return (
      <PageLayout
        header={
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <Heading level={1} size="base" truncate>
              <Link
                to="/dashboard/$id/automations"
                params={{ id: organizationId }}
                className="text-muted-foreground hidden cursor-pointer md:inline"
              >
                {t('title')}&nbsp;&nbsp;
              </Link>
            </Heading>
          </AdaptiveHeaderRoot>
        }
        organizationId={organizationId}
      >
        <Center className="flex-1">
          <Heading level={2} size="sm">
            Workflow not found: {getSlugBaseName(workflowSlug)}
          </Heading>
        </Center>
      </PageLayout>
    );
  }

  return (
    <WorkflowConfigProvider workflowSlug={workflowSlug} initialConfig={config}>
      <AutomationDetailInner
        organizationId={organizationId}
        amId={amId}
        workflowSlug={workflowSlug}
        onRefetch={refetch}
      />
    </WorkflowConfigProvider>
  );
}

interface AutomationDetailInnerProps {
  organizationId: string;
  amId: string;
  workflowSlug: string;
  onRefetch: () => Promise<void>;
}

function AutomationDetailInner({
  organizationId,
  amId,
  workflowSlug,
  onRefetch,
}: AutomationDetailInnerProps) {
  const location = useLocation();
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { config } = useWorkflowConfig();
  const [isAIChatOpen, setIsAIChatOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(384);

  const handleCloseAIChat = useCallback(() => {
    setIsAIChatOpen(false);
  }, []);

  useEffect(() => {
    const handler = () => void onRefetch();
    window.addEventListener('workflow-updated', handler);
    return () => window.removeEventListener('workflow-updated', handler);
  }, [onRefetch]);

  const isExactAutomationPage =
    location.pathname === `/dashboard/${organizationId}/automations/${amId}`;

  const steps = useMemo(
    () =>
      config.steps.map((step, index) => ({
        _id: `${workflowSlug}:${step.stepSlug}`,
        _creationTime: 0,
        organizationId,
        wfDefinitionId: workflowSlug,
        stepSlug: step.stepSlug,
        name: step.name,
        description: step.description,
        stepType: step.stepType,
        order: step.order ?? index,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based config is validated by schema
        config: step.config as Doc<'wfStepDefs'>['config'],
        nextSteps: step.nextSteps,
      })),
    [config.steps, workflowSlug, organizationId],
  );

  return (
    <PageLayout
      header={
        <>
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <Heading level={1} size="base" truncate>
              <Link
                to="/dashboard/$id/automations"
                params={{ id: organizationId }}
                className="text-muted-foreground hidden cursor-pointer md:inline"
              >
                {t('title')}&nbsp;&nbsp;
              </Link>
              <span className="hidden md:inline">/&nbsp;&nbsp;</span>
              {config.name}
            </Heading>
            {config.enabled ? (
              <Badge variant="green" className="ml-2">
                {tCommon('status.published')}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2">
                {tCommon('status.draft')}
              </Badge>
            )}
            {config.version && (
              <Badge variant="outline" className="ml-2">
                v{config.version}
              </Badge>
            )}
          </AdaptiveHeaderRoot>
          <AutomationNavigation
            organizationId={organizationId}
            automationId={amId}
            workflowSlug={workflowSlug}
            onRefetch={onRefetch}
          />
        </>
      }
      organizationId={organizationId}
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isExactAutomationPage ? (
            <Suspense fallback={<AutomationStepsSkeleton />}>
              <AutomationSteps
                status={config.enabled ? 'active' : 'draft'}
                className="flex-1"
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to Doc shape; component only reads display fields
                steps={steps as Doc<'wfStepDefs'>[]}
                organizationId={organizationId}
                automationId={workflowSlug}
              />
            </Suspense>
          ) : (
            <Outlet />
          )}
        </div>

        {isAIChatOpen && (
          <AutomationAIChatPanel
            workflowSlug={workflowSlug}
            workflowName={config.name}
            organizationId={organizationId}
            onClose={handleCloseAIChat}
            panelWidth={panelWidth}
            onPanelWidthChange={setPanelWidth}
          />
        )}
      </div>
    </PageLayout>
  );
}
