import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { Center } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  createFileRoute,
  Outlet,
  useLocation,
  Link,
} from '@tanstack/react-router';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
import { AutomationAIChatPanel } from '@/app/features/automations/components/automation-ai-chat-panel';
import { AutomationNavigation } from '@/app/features/automations/components/automation-navigation';
import { AutomationSidePanel } from '@/app/features/automations/components/automation-sidepanel';
import { AUTOMATION_PANEL_URL_DEFINITIONS } from '@/app/features/automations/components/automation-steps';
import { ExecutionStatusProvider } from '@/app/features/automations/components/execution-status-context';
import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import {
  WorkflowConfigProvider,
  useWorkflowConfig,
} from '@/app/features/automations/hooks/use-workflow-config-context';
import { useWorkflowActivity } from '@/app/features/automations/triggers/hooks/queries';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { useUrlState } from '@/app/hooks/use-url-state';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
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
  // The Executions tab is one click away on every automation detail page,
  // but it's off-screen on first paint (the canvas tab lands by default).
  // Prime the executions list cache fire-and-forget so opening Executions
  // paints instantly with the first page already warm — same pattern as the
  // chat sidebar and the knowledge tables. Filter-free args mirror the
  // table's unfiltered call site; filtered views still hit the network
  // (different cache key) but those are user-driven, not on-load.
  loader: ({ context, params }) => {
    const wfDefinitionId = urlParamToSlug(params.amId);
    // Warm the code-split ReactFlow canvas chunk while the workflow data is
    // still loading. The chunk download overlaps the (slower) Convex read, so
    // by the time `config` resolves and the canvas mounts the chunk is already
    // in cache — no Suspense fallback → no first-open layout shift between the
    // canvas skeleton and the real canvas. Fire-and-forget; render-time
    // Suspense still covers the cold-cache case.
    void import('@/app/features/automations/components/automation-steps');
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.wf_executions.queries.listExecutions,
      { wfDefinitionId },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: AutomationDetailLayout,
});

const MAX_READ_RETRIES = 3;
const READ_RETRY_DELAY_MS = 500;

// Placeholder step cards mapped while the workflow loads. The values only give
// the masked leaves a realistic size; they are never shown (SkeletonBox hides
// them inside the surrounding <Skeletonize loading>).
const PLACEHOLDER_STEPS = [
  { name: 'Start', description: 'Workflow entry point', type: 'Trigger' },
  {
    name: 'Process data',
    description: 'Transform the payload',
    type: 'Action',
  },
  { name: 'Finish', description: 'Return the result', type: 'Output' },
] as const;

/**
 * Static canvas placeholder shared by the route-level loading state and the
 * Suspense fallback for the lazily code-split ReactFlow canvas. Reusing one
 * placeholder for both is what removes the skeleton "blink": once the workflow
 * data resolves but the canvas chunk is still downloading, the user keeps
 * seeing the identical step-card placeholder instead of a generic text
 * skeleton flashing in for a frame. Callers wrap it in `<Skeletonize loading>`.
 */
function AutomationCanvasSkeleton() {
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
            {PLACEHOLDER_STEPS.map((step, index) => (
              <div key={step.name}>
                {index > 0 && (
                  <div className="border-muted-foreground/30 mx-auto h-8 w-0 border-l-2" />
                )}
                {/* Real step-card shape (mirrors AutomationStep):
                    icon, heading, caption, trailing type badge. */}
                <div className="border-border bg-card w-[18.75rem] rounded-lg border shadow-sm">
                  <div className="flex gap-3 px-2.5 py-2">
                    <SkeletonBox>
                      <div className="size-5 shrink-0 rounded-sm" />
                    </SkeletonBox>
                    <div className="min-w-0 flex-1">
                      <Heading level={3} size="sm">
                        <SkeletonBox>{step.name}</SkeletonBox>
                      </Heading>
                      <Text variant="caption" className="mt-1 line-clamp-2">
                        <SkeletonBox>{step.description}</SkeletonBox>
                      </Text>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-muted-foreground h-fit px-1 py-0.5 text-xs"
                    >
                      <SkeletonBox>{step.type}</SkeletonBox>
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Center>
        <div className="absolute right-4 bottom-4">
          <SkeletonBox>
            <div className="border-border h-[128px] w-[192px] rounded-lg border shadow-sm" />
          </SkeletonBox>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="ring-border bg-background flex items-center gap-2 rounded-lg p-1 shadow-sm ring-1">
            <SkeletonBox>
              <div className="size-8 rounded-md" />
            </SkeletonBox>
            <SkeletonBox>
              <div className="size-8 rounded-md" />
            </SkeletonBox>
            <SkeletonBox>
              <div className="size-8 rounded-md" />
            </SkeletonBox>
            <SkeletonBox>
              <div className="size-8 rounded-md" />
            </SkeletonBox>
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
          <Skeletonize loading>
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
                <SkeletonBox>
                  <span className="inline-block h-4 w-32 align-middle" />
                </SkeletonBox>
              </Heading>
            </AdaptiveHeaderRoot>
            {/* Real tab strip: the static tab labels are known at load and
                stay real text; only the trailing assistant/history actions
                (data-dependent) are masked. */}
            <div className="border-border flex min-h-12 shrink-0 flex-nowrap items-center gap-4 border-b px-4">
              <Text variant="caption">{t('navigation.editor')}</Text>
              <Text variant="caption">{t('executions.title')}</Text>
              <Text variant="caption">{t('configuration.title')}</Text>
              <Text variant="caption">{t('triggers.title')}</Text>
              <div className="ml-auto flex items-center gap-2">
                <SkeletonBox>
                  <div className="size-8 rounded-md" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="h-8 w-20 rounded-md" />
                </SkeletonBox>
              </div>
            </div>
          </Skeletonize>
        }
        organizationId={organizationId}
      >
        {/* Mirror the loaded body: canvas column + reserved AI panel, so the
            real layout swaps in without a horizontal/vertical jump. The real
            step-card structure renders once here; with no steps yet during
            load we map a few placeholder cards, each masked in place. */}
        {/* `contents`: Skeletonize's wrapper <div> must not generate a box, or
            its default `display:block`/auto-height breaks the flex chain from
            PageLayout's column — the canvas would collapse to ~0px and the
            absolutely-positioned toolbar/minimap/steps would pile at the top.
            With `contents`, the row below is the direct flex child of the
            column, exactly like the loaded layout. */}
        <Skeletonize loading className="contents">
          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
              <AutomationCanvasSkeleton />
            </div>
            {/* Real AI-panel aside (mounts open by default once loaded): same
                fixed-width bordered column with a masked header. */}
            <aside
              style={{ width: 384 }}
              className="bg-background border-border hidden min-h-0 shrink-0 flex-col border-l md:flex"
            >
              <div className="border-border flex shrink-0 items-center gap-3 border-b p-3">
                <SkeletonBox>
                  <div className="size-8 rounded-lg" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="h-4 w-28" />
                </SkeletonBox>
                <div className="ml-auto">
                  <SkeletonBox>
                    <div className="size-8 rounded-md" />
                  </SkeletonBox>
                </div>
              </div>
            </aside>
          </div>
        </Skeletonize>
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
      <ExecutionStatusProvider>
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            {isExactAutomationPage ? (
              <SuspenseBoundary
                fallback={
                  // The ReactFlow canvas is a genuine code-split chunk, so a
                  // fallback is unavoidable while it downloads — but reuse the
                  // SAME step-card placeholder as the route-level loading state
                  // instead of a generic text skeleton. Otherwise the skeleton
                  // visibly "blinks": canvas placeholder → text lines → canvas.
                  <Skeletonize loading className="contents">
                    <AutomationCanvasSkeleton />
                  </Skeletonize>
                }
              >
                <AutomationSteps
                  hasActiveTrigger={hasActiveTrigger}
                  className="flex-1"
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to Doc shape; component only reads display fields
                  steps={steps as Doc<'wfStepDefs'>[]}
                  onOpenAIChat={handleOpenAIChat}
                />
              </SuspenseBoundary>
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
      </ExecutionStatusProvider>
    </PageLayout>
  );
}
