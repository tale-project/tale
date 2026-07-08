import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Center, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from '@tanstack/react-router';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { HeaderBreadcrumbs } from '@/app/components/layout/header-breadcrumbs';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
import { useAutomations } from '@/app/features/automations/hooks/use-automations';
import {
  EditorViewFloatingBar,
  EditorViewToggle,
} from '@/app/features/workflows/components/editor-view-toggle';
import { ExecutionStatusProvider } from '@/app/features/workflows/components/execution-status-context';
import { WorkflowAIChatPanel } from '@/app/features/workflows/components/workflow-ai-chat-panel';
import { WorkflowNavigation } from '@/app/features/workflows/components/workflow-navigation';
import { WorkflowSidePanel } from '@/app/features/workflows/components/workflow-sidepanel';
import { WorkflowSpecification } from '@/app/features/workflows/components/workflow-specification';
import { WORKFLOW_PANEL_URL_DEFINITIONS } from '@/app/features/workflows/components/workflow-steps';
import { useReadWorkflow } from '@/app/features/workflows/hooks/file-queries';
import { useWorkflowEditorView } from '@/app/features/workflows/hooks/use-editor-view';
import {
  WorkflowConfigProvider,
  useWorkflowConfig,
} from '@/app/features/workflows/hooks/use-workflow-config-context';
import { useWorkflowActivity } from '@/app/features/workflows/triggers/hooks/queries';
import type {
  StepConfig,
  StepDef,
} from '@/app/features/workflows/utils/step-icons';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { useUrlState } from '@/app/hooks/use-url-state';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { resolveWorkflowStepText } from '@/lib/shared/utils/resolve-workflow-locale';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug, getSlugBaseName } from '@/lib/utils/workflow-slug';

const WorkflowSteps = lazy(() =>
  import('@/app/features/workflows/components/workflow-steps').then((mod) => ({
    default: mod.WorkflowSteps,
  })),
);

const searchSchema = z.object({
  panel: z.string().optional(),
  // Selected step slug for the canvas step-config side panel. The canvas writes
  // it via `useUrlState` (the same keys the automation Editor tab route at
  // `automations/$automationSlug/index.tsx` declares); it MUST be declared here too,
  // or TanStack Router strips the undeclared param on navigate and clicking a
  // node opens an empty side panel instead of the step editor.
  step: z.string().optional(),
  // Viewed-run id for the canvas run view (per-node badges + "Viewing run …"
  // banner). Written by the tester panel and by the Executions tab's "View on
  // canvas" row action, and read via `ExecutionStatusProvider` (#2347).
  execution: z.string().optional(),
  // Optionally forces the Graph/Specification toggle for this one visit; the
  // cookie (not this param) is the cross-workflow default
  // (`useWorkflowEditorView`).
  view: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/workflows/$workflowId')({
  head: () => ({
    meta: seo('workflow'),
  }),
  validateSearch: searchSchema,
  // The Executions tab is one click away on every workflow detail page,
  // but it's off-screen on first paint (the canvas tab lands by default).
  // Prime the executions list cache fire-and-forget so opening Executions
  // paints instantly with the first page already warm — same pattern as the
  // chat sidebar and the knowledge tables. Filter-free args mirror the
  // table's unfiltered call site; filtered views still hit the network
  // (different cache key) but those are user-driven, not on-load.
  loader: ({ context, params }) => {
    const wfDefinitionId = urlParamToSlug(params.workflowId);
    // Warm the code-split ReactFlow canvas chunk while the workflow data is
    // still loading. The chunk download overlaps the (slower) Convex read, so
    // by the time `config` resolves and the canvas mounts the chunk is already
    // in cache — no Suspense fallback → no first-open layout shift between the
    // canvas skeleton and the real canvas. Fire-and-forget; render-time
    // Suspense still covers the cold-cache case.
    void import('@/app/features/workflows/components/workflow-steps');
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.workflow_executions.queries.listExecutions,
      { wfDefinitionId },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: WorkflowDetailLayout,
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
function WorkflowCanvasSkeleton() {
  return (
    <Row
      gap={0}
      align="stretch"
      className="relative w-full flex-1 justify-stretch overflow-auto"
    >
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
          <Stack gap={0} align="center">
            {PLACEHOLDER_STEPS.map((step, index) => (
              <div key={step.name}>
                {index > 0 && (
                  <div className="border-muted-foreground/30 mx-auto h-8 w-0 border-l-2" />
                )}
                {/* Real step-card shape (mirrors WorkflowStep):
                    icon, heading, caption, trailing type badge. */}
                <div className="border-border bg-card w-[18.75rem] rounded-lg border shadow-sm">
                  <Row gap={3} align="stretch" className="px-2.5 py-2">
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
                  </Row>
                </div>
              </div>
            ))}
          </Stack>
        </Center>
        <div className="absolute right-4 bottom-4">
          <SkeletonBox>
            <div className="border-border h-[128px] w-[192px] rounded-lg border shadow-sm" />
          </SkeletonBox>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Row
            gap={2}
            className="ring-border bg-background rounded-lg p-1 shadow-sm ring-1"
          >
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
          </Row>
        </div>
      </div>
    </Row>
  );
}

function WorkflowDetailLayout() {
  const { id: organizationId, workflowId } = Route.useParams();
  const workflowSlug = urlParamToSlug(workflowId);
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');

  const {
    data: readResult,
    isLoading,
    refetch,
  } = useReadWorkflow(organizationId, workflowSlug);

  // Canonicalize: an automation-owned (inline) workflow's home is the
  // automation detail page — its slug IS the automation slug (checked below,
  // after every hook, on POSITIVE confirmation only).
  const { automations } = useAutomations(organizationId);

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

  // An installed automation with this exact (bare) slug owns the workflow —
  // its settings live on the automation page. Redirecting only when the
  // installed list POSITIVELY carries the slug means a cold load can never
  // misroute; standalone workflows (integration sync templates, foldered
  // slugs) render here as before.
  if (
    !workflowSlug.includes('/') &&
    automations.some((a) => a.slug === workflowSlug)
  ) {
    return (
      <Navigate
        to="/dashboard/$id/automations/$automationSlug"
        params={{ id: organizationId, automationSlug: workflowSlug }}
        replace
      />
    );
  }

  if (isLoading || (notFoundResult && isRetrying)) {
    return (
      <PageLayout
        header={
          <Skeletonize loading>
            <AdaptiveHeaderRoot standalone={false} className="gap-2">
              <HeaderBreadcrumbs
                ariaLabel={tCommon('aria.breadcrumb')}
                crumbs={[
                  {
                    key: 'workflows',
                    content: (
                      <span className="text-muted-foreground">
                        {t('title')}
                      </span>
                    ),
                  },
                ]}
                leaf={
                  <SkeletonBox>
                    <span className="inline-block h-4 w-32 align-middle" />
                  </SkeletonBox>
                }
              />
            </AdaptiveHeaderRoot>
            {/* Real tab strip: the static tab labels are known at load and
                stay real text; only the trailing assistant/history actions
                (data-dependent) are masked. */}
            <Row className="border-border min-h-12 shrink-0 border-b px-4">
              <Text variant="caption">{t('navigation.editor')}</Text>
              <Text variant="caption">{t('executions.title')}</Text>
              <Text variant="caption">{t('configuration.title')}</Text>
              <Text variant="caption">{t('triggers.title')}</Text>
              <Row gap={2} className="ml-auto">
                <SkeletonBox>
                  <div className="size-8 rounded-md" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="h-8 w-20 rounded-md" />
                </SkeletonBox>
              </Row>
            </Row>
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
          <Row gap={0} align="stretch" className="relative min-h-0 flex-1">
            <Stack gap={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <WorkflowCanvasSkeleton />
            </Stack>
            {/* Real AI-panel aside (mounts open by default once loaded): same
                fixed-width bordered column with a masked header. */}
            <aside
              style={{ width: 384 }}
              className="bg-background border-border hidden min-h-0 shrink-0 flex-col border-l md:flex"
            >
              <Row gap={3} className="border-border shrink-0 border-b p-3">
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
              </Row>
            </aside>
          </Row>
        </Skeletonize>
      </PageLayout>
    );
  }

  if (!config) {
    return (
      <PageLayout
        header={
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <HeaderBreadcrumbs
              ariaLabel={tCommon('aria.breadcrumb')}
              crumbs={[
                {
                  key: 'workflows',
                  content: (
                    <span className="text-muted-foreground">{t('title')}</span>
                  ),
                },
              ]}
              leaf={getSlugBaseName(workflowSlug)}
            />
          </AdaptiveHeaderRoot>
        }
        organizationId={organizationId}
      >
        <Center className="flex-1">
          <Heading level={2} size="sm">
            {t('notFound', { slug: getSlugBaseName(workflowSlug) })}
          </Heading>
        </Center>
      </PageLayout>
    );
  }

  return (
    <WorkflowConfigProvider workflowSlug={workflowSlug} initialConfig={config}>
      <ActiveEditorProvider>
        <WorkflowDetailInner
          organizationId={organizationId}
          workflowId={workflowId}
          workflowSlug={workflowSlug}
          onRefetch={async () => {
            await refetch();
          }}
        />
      </ActiveEditorProvider>
    </WorkflowConfigProvider>
  );
}

interface WorkflowDetailInnerProps {
  organizationId: string;
  workflowId: string;
  workflowSlug: string;
  onRefetch: () => Promise<void>;
}

function WorkflowDetailInner({
  organizationId,
  workflowId,
  workflowSlug,
  onRefetch,
}: WorkflowDetailInnerProps) {
  const location = useLocation();
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const { config } = useWorkflowConfig();
  const { hasActiveTrigger } = useWorkflowActivity(
    organizationId,
    workflowSlug,
  );
  const [isAIChatOpen, setIsAIChatOpen] = useState(true);
  const [editorView, setEditorView] = useWorkflowEditorView();
  const [panelWidth, setPanelWidth] = usePersistedState(
    'workflow-side-panel-width',
    384,
  );

  const { state: panelState, clearAll: clearPanelUrlState } = useUrlState({
    definitions: WORKFLOW_PANEL_URL_DEFINITIONS,
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

  const isExactWorkflowPage =
    location.pathname ===
    `/dashboard/${organizationId}/workflows/${workflowId}`;
  // The Graph/Specification toggle only exists on the editor tab itself —
  // its AI-chat/side panels are graph-editing tools with no meaning in the
  // Specification view, so both are hidden there (mirrors
  // `AutomationWorkflowEditorTab`'s simpler swap).
  const isSpecificationView =
    isExactWorkflowPage && editorView === 'specification';

  const steps = useMemo(
    () =>
      config.steps.map((step, index) => {
        // A step's own inline `i18n` (workflowStepI18nSchema) resolves its
        // displayed name/description; falls back to the literal (English)
        // when the step declares no override — see resolve-workflow-locale.ts.
        const text = resolveWorkflowStepText(step, locale);
        return {
          _id: `${workflowSlug}:${step.stepSlug}`,
          _creationTime: 0,
          organizationId,
          wfDefinitionId: workflowSlug,
          stepSlug: step.stepSlug,
          name: text.name,
          description: text.description,
          stepType: step.stepType,
          order: step.order ?? index,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based config is validated by schema
          config: step.config as StepConfig,
          nextSteps: step.nextSteps,
        };
      }),
    [config.steps, workflowSlug, organizationId, locale],
  );

  const selectedStep = useMemo(() => {
    if (!panelState.step) return null;
    const found = steps.find((s) => s.stepSlug === panelState.step);
    if (!found) return null;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to StepDef shape; WorkflowSidePanel only reads display fields
    return found as StepDef;
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
            <HeaderBreadcrumbs
              ariaLabel={tCommon('aria.breadcrumb')}
              crumbs={[
                {
                  key: 'workflows',
                  content: (
                    <span className="text-muted-foreground">{t('title')}</span>
                  ),
                },
              ]}
              leaf={getSlugBaseName(workflowSlug)}
            />
          </AdaptiveHeaderRoot>
          <WorkflowNavigation
            organizationId={organizationId}
            workflowId={workflowId}
            workflowSlug={workflowSlug}
            onRefetch={onRefetch}
            isAssistantOpen={isAIChatOpen}
            // On the editor tab the canvas's bottom-center toolbar already
            // carries the ✨ button — offering it in the tab strip too would
            // show the same control twice.
            onOpenAssistant={isExactWorkflowPage ? undefined : handleOpenAIChat}
          />
        </>
      }
      organizationId={organizationId}
    >
      <ExecutionStatusProvider>
        <Row gap={0} align="stretch" className="relative min-h-0 flex-1">
          <Stack gap={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {isExactWorkflowPage ? (
              editorView === 'specification' ? (
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <WorkflowSpecification
                    organizationId={organizationId}
                    workflowSlug={workflowSlug}
                  />
                  <EditorViewFloatingBar>
                    <EditorViewToggle
                      view={editorView}
                      onViewChange={setEditorView}
                    />
                  </EditorViewFloatingBar>
                </div>
              ) : (
                <SuspenseBoundary
                  fallback={
                    // The ReactFlow canvas is a genuine code-split chunk, so a
                    // fallback is unavoidable while it downloads — but reuse the
                    // SAME step-card placeholder as the route-level loading state
                    // instead of a generic text skeleton. Otherwise the skeleton
                    // visibly "blinks": canvas placeholder → text lines → canvas.
                    <Skeletonize loading className="contents">
                      <WorkflowCanvasSkeleton />
                    </Skeletonize>
                  }
                >
                  <WorkflowSteps
                    hasActiveTrigger={hasActiveTrigger}
                    className="flex-1"
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to StepDef shape; component only reads display fields
                    steps={steps as StepDef[]}
                    onOpenAIChat={handleOpenAIChat}
                    viewToggle={
                      <EditorViewToggle
                        view={editorView}
                        onViewChange={setEditorView}
                      />
                    }
                  />
                </SuspenseBoundary>
              )
            ) : (
              <Outlet />
            )}
          </Stack>

          {isAIChatOpen && !isUrlSidePanelOpen && !isSpecificationView && (
            <WorkflowAIChatPanel
              workflowSlug={workflowSlug}
              workflowName={getSlugBaseName(workflowSlug)}
              organizationId={organizationId}
              onClose={handleCloseAIChat}
              panelWidth={panelWidth}
              onPanelWidthChange={setPanelWidth}
            />
          )}

          {isUrlSidePanelOpen && !isSpecificationView && (
            <WorkflowSidePanel
              step={selectedStep}
              isOpen
              onClose={clearPanelUrlState}
              showTestPanel={panelState.panel === 'test'}
              workflowId={workflowSlug}
              organizationId={organizationId}
              stepOptions={stepOptions}
              panelWidth={panelWidth}
              onPanelWidthChange={setPanelWidth}
            />
          )}
        </Row>
      </ExecutionStatusProvider>
    </PageLayout>
  );
}
