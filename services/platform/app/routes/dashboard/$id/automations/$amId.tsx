import { Heading } from '@tale/ui/heading';
import { Center } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
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
  useRef,
  useState,
} from 'react';
import { z } from 'zod';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
import { AutomationAIChatPanel } from '@/app/features/automations/components/automation-ai-chat-panel';
import { AutomationNavigation } from '@/app/features/automations/components/automation-navigation';
import { AutomationSidePanel } from '@/app/features/automations/components/automation-sidepanel';
import { AUTOMATION_PANEL_URL_DEFINITIONS } from '@/app/features/automations/components/automation-steps';
import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import {
  WorkflowConfigProvider,
  useWorkflowConfig,
} from '@/app/features/automations/hooks/use-workflow-config-context';
import { useWorkflowActivity } from '@/app/features/automations/triggers/hooks/queries';
import { useUrlState } from '@/app/hooks/use-url-state';
import type { Doc } from '@/convex/_generated/dataModel';
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

// Mirrors `AutomationStep`'s card: same `w-[18.75rem]` width, border, padding,
// icon size, two text lines, and trailing type badge — so swapping the real
// nodes in doesn't reflow the canvas.
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

/**
 * Canvas-only skeleton. Matches `AutomationSteps`' outer wrapper
 * (`relative flex w-full flex-1 justify-stretch overflow-auto`) and inner
 * `bg-background flex-[1_1_0]` pane, then mirrors the dotted background,
 * a vertical chain of step cards, the bottom-right minimap (default 192×128),
 * and the bottom-center 4-button toolbar — so the live ReactFlow swaps in
 * without the canvas, minimap, or toolbar moving.
 *
 * Used both as the route-level loading body (wrapped to reserve the AI panel)
 * and as the lazy `<AutomationSteps>` Suspense fallback (where the panel is
 * already mounted), so the chunk load is invisible.
 */
function AutomationStepsSkeleton() {
  return (
    <div className="relative flex w-full flex-1 justify-stretch overflow-auto">
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
          <Skeleton className="border-border h-[128px] w-[192px] rounded-lg border shadow-sm" />
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

/**
 * Placeholder for the AI assistant side panel, which mounts open by default
 * (`isAIChatOpen` starts `true`) at its initial 384px width once the workflow
 * loads. Reserving the same fixed-width bordered column during loading stops
 * the canvas from shrinking sideways when the real panel appears. Hidden on
 * mobile, where the live panel overlays instead of taking layout space.
 */
function AutomationAIPanelSkeleton() {
  return (
    <aside
      aria-hidden="true"
      style={{ width: 384 }}
      className="bg-background border-border hidden min-h-0 shrink-0 flex-col border-l md:flex"
    >
      <div className="border-border flex shrink-0 items-center gap-3 border-b p-3">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="ml-auto size-8 rounded-md" />
      </div>
    </aside>
  );
}

/**
 * Placeholder for the second header row (`AutomationNavigation` → its
 * `TabNavigation`), which only mounts once the workflow config resolves.
 * Matches the strip's `min-h-12 border-b px-4` so the body doesn't jump down
 * when the real tabs appear, and stands in the trailing assistant/history
 * actions.
 */
function AutomationTabsSkeleton() {
  return (
    <div className="border-border flex min-h-12 shrink-0 flex-nowrap items-center gap-4 border-b px-4">
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-16" />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}

const MAX_READ_RETRIES = 3;
const READ_RETRY_DELAY_MS = 500;

function AutomationDetailLayout() {
  const { id: organizationId, amId } = Route.useParams();
  const workflowSlug = urlParamToSlug(amId);
  const { t } = useT('automations');

  const {
    data: readResult,
    isLoading,
    refetch,
  } = useReadWorkflow(organizationId, workflowSlug);

  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notFoundResult = readResult && !readResult.ok;
  const isRetrying =
    retryCountRef.current > 0 && retryCountRef.current < MAX_READ_RETRIES;

  useEffect(() => {
    if (notFoundResult && retryCountRef.current < MAX_READ_RETRIES) {
      retryTimerRef.current = setTimeout(() => {
        retryCountRef.current += 1;
        void refetch();
      }, READ_RETRY_DELAY_MS);
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [notFoundResult, refetch, readResult]);

  useEffect(() => {
    retryCountRef.current = 0;
  }, [workflowSlug]);

  const config = useMemo(() => {
    if (!readResult || !readResult.ok) return undefined;
    return readResult.config;
  }, [readResult]);

  if (isLoading || (notFoundResult && isRetrying)) {
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
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              </Heading>
            </AdaptiveHeaderRoot>
            <AutomationTabsSkeleton />
          </>
        }
        organizationId={organizationId}
      >
        {/* Mirror the loaded body: canvas column + reserved AI panel, so the
            real layout swaps in without a horizontal/vertical jump. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <AutomationStepsSkeleton />
          </div>
          <AutomationAIPanelSkeleton />
        </div>
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
      <ActiveEditorProvider>
        <AutomationDetailInner
          organizationId={organizationId}
          amId={amId}
          workflowSlug={workflowSlug}
          onRefetch={async () => {
            await refetch();
          }}
        />
      </ActiveEditorProvider>
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
  const { config } = useWorkflowConfig();
  const { hasActiveTrigger } = useWorkflowActivity(
    organizationId,
    workflowSlug,
  );
  const [isAIChatOpen, setIsAIChatOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(384);

  const { state: panelState, clearAll: clearPanelUrlState } = useUrlState({
    definitions: AUTOMATION_PANEL_URL_DEFINITIONS,
  });
  const isUrlSidePanelOpen =
    panelState.panel === 'test' || panelState.panel === 'step';

  const handleCloseAIChat = useCallback(() => {
    setIsAIChatOpen(false);
  }, []);

  const handleOpenAIChat = useCallback(() => {
    clearPanelUrlState();
    setIsAIChatOpen(true);
  }, [clearPanelUrlState]);

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

  const selectedStep = useMemo(() => {
    if (!panelState.step) return null;
    const found = steps.find((s) => s.stepSlug === panelState.step);
    if (!found) return null;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to Doc shape; AutomationSidePanel only reads display fields
    return found as Doc<'wfStepDefs'>;
  }, [steps, panelState.step]);

  const stepOptions = useMemo(
    () =>
      steps.map((s) => ({
        stepSlug: s.stepSlug,
        name: s.name,
        stepType: s.stepType,
        actionType:
          s.stepType === 'action' && 'type' in s.config
            ? s.config.type
            : undefined,
      })),
    [steps],
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
          </AdaptiveHeaderRoot>
          <AutomationNavigation
            organizationId={organizationId}
            automationId={amId}
            workflowSlug={workflowSlug}
            onRefetch={onRefetch}
            isAssistantOpen={isAIChatOpen}
            onOpenAssistant={handleOpenAIChat}
          />
        </>
      }
      organizationId={organizationId}
    >
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {isExactAutomationPage ? (
            <Suspense fallback={<AutomationStepsSkeleton />}>
              <AutomationSteps
                hasActiveTrigger={hasActiveTrigger}
                className="flex-1"
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to Doc shape; component only reads display fields
                steps={steps as Doc<'wfStepDefs'>[]}
                onOpenAIChat={handleOpenAIChat}
              />
            </Suspense>
          ) : (
            <Outlet />
          )}
        </div>

        {isAIChatOpen && !isUrlSidePanelOpen && (
          <AutomationAIChatPanel
            workflowSlug={workflowSlug}
            workflowName={config.name}
            organizationId={organizationId}
            onClose={handleCloseAIChat}
            panelWidth={panelWidth}
            onPanelWidthChange={setPanelWidth}
          />
        )}

        {isUrlSidePanelOpen && (
          <AutomationSidePanel
            step={selectedStep}
            isOpen
            onClose={clearPanelUrlState}
            showTestPanel={panelState.panel === 'test'}
            automationId={workflowSlug}
            organizationId={organizationId}
            stepOptions={stepOptions}
            panelWidth={panelWidth}
            onPanelWidthChange={setPanelWidth}
          />
        )}
      </div>
    </PageLayout>
  );
}
