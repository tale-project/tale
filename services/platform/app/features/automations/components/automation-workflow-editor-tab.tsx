'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
/**
 * The automation detail page's "Editor" tab — the automation's workflow
 * (`manifest.workflows[0]`), rendered from the shared workflow-editor
 * components: `WorkflowConfigProvider`
 * + `WorkflowSteps` (the canvas) + `WorkflowSidePanel` (step config / test
 * run) + `WorkflowAIChatPanel` (the canvas assistant). The Graph ⇄
 * Specification mode toggle (W5b) lives in the canvas's bottom-center toolbar
 * (and the same-styled floating bar over the text editor) —
 * `useWorkflowEditorView` persists the choice in a cookie shared across every
 * workflow, layered under an optional `?view=` URL override.
 */
import { Fragment, lazy, useCallback, useMemo, type ReactNode } from 'react';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import {
  EditorViewFloatingBar,
  EditorViewToggle,
} from '@/app/features/workflows/components/editor-view-toggle';
import { ExecutionStatusProvider } from '@/app/features/workflows/components/execution-status-context';
import { WorkflowAIChatPanel } from '@/app/features/workflows/components/workflow-ai-chat-panel';
import { WorkflowSidePanel } from '@/app/features/workflows/components/workflow-sidepanel';
import { WorkflowSpecification } from '@/app/features/workflows/components/workflow-specification';
import { WORKFLOW_PANEL_URL_DEFINITIONS } from '@/app/features/workflows/components/workflow-steps';
import { useReadWorkflow } from '@/app/features/workflows/hooks/file-queries';
import { useWorkflowEditorView } from '@/app/features/workflows/hooks/use-editor-view';
import {
  useWorkflowConfig,
  WorkflowConfigProvider,
} from '@/app/features/workflows/hooks/use-workflow-config-context';
import { useWorkflowActivity } from '@/app/features/workflows/triggers/hooks/queries';
import type {
  StepConfig,
  StepDef,
} from '@/app/features/workflows/utils/step-icons';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useUrlState } from '@/app/hooks/use-url-state';
import { useT } from '@/lib/i18n/client';
import { resolveWorkflowStepText } from '@/lib/shared/utils/resolve-workflow-locale';

const WorkflowSteps = lazy(() =>
  import('@/app/features/workflows/components/workflow-steps').then((mod) => ({
    default: mod.WorkflowSteps,
  })),
);

/**
 * The editor's loading placeholder — a centered column of step-node cards joined
 * by short connectors, so the skeleton→graph swap doesn't lurch from stacked
 * text lines to a diagram. Shared by BOTH the workflow-read wait and the lazy
 * canvas-chunk Suspense fallback, so the two phases show one continuous shape
 * rather than two different skeletons flashing in sequence.
 */
function EditorLoadingSkeleton() {
  const nodes = [0, 1, 2, 3];
  return (
    <Skeletonize
      loading
      className="relative flex min-h-0 flex-1 overflow-hidden"
    >
      {/* The step-node column, centered like the real canvas. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden py-10">
        {nodes.map((i) => (
          <Fragment key={i}>
            <SkeletonBox>
              <div className="h-14 w-72 rounded-lg" />
            </SkeletonBox>
            {i < nodes.length - 1 && (
              <SkeletonBox>
                <div className="h-6 w-px" />
              </SkeletonBox>
            )}
          </Fragment>
        ))}
      </div>
      {/* The bottom-center action toolbar the real editor floats there — so the
          skeleton reads as "the editor is loading", not a blank column. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <SkeletonBox>
          <div className="h-9 w-44 rounded-lg" />
        </SkeletonBox>
      </div>
    </Skeletonize>
  );
}

/** Canvas + side panels — mounted once the workflow config is loaded, inside
 *  `WorkflowConfigProvider` so `useWorkflowConfig` resolves. */
function EditorCanvas({
  organizationId,
  workflowSlug,
  viewToggle,
  isAIChatOpen,
  onAIChatOpenChange,
  setupIncomplete,
}: {
  organizationId: string;
  workflowSlug: string;
  /** The Graph ⇄ Specification toggle, rendered in the canvas toolbar. */
  viewToggle?: ReactNode;
  /** AI Assistant open-state, lifted to the detail page so its toggle lives in
   *  the tab strip rather than the canvas toolbar. */
  isAIChatOpen: boolean;
  onAIChatOpenChange: (open: boolean) => void;
  /** Automation setup isn't done — suppress the "workflow is active" banner. */
  setupIncomplete?: boolean;
}) {
  const { locale } = useLocale();
  const { config } = useWorkflowConfig();
  const { hasActiveTrigger } = useWorkflowActivity(
    organizationId,
    workflowSlug,
  );
  const [panelWidth, setPanelWidth] = usePersistedState(
    'workflow-side-panel-width',
    384,
  );
  const { state: panelState, clearAll: clearPanelUrlState } = useUrlState({
    definitions: WORKFLOW_PANEL_URL_DEFINITIONS,
  });
  const isUrlSidePanelOpen =
    panelState.panel === 'test' || panelState.panel === 'step';

  const handleCloseAIChat = useCallback(
    () => onAIChatOpenChange(false),
    [onAIChatOpenChange],
  );
  // The ✨ button in the canvas toolbar TOGGLES the AI Assistant: opening it
  // clears any step/test side panel so the chat can take the shared right rail;
  // pressing it again closes the panel.
  const handleToggleAIChat = useCallback(() => {
    if (isAIChatOpen) {
      onAIChatOpenChange(false);
      return;
    }
    clearPanelUrlState();
    onAIChatOpenChange(true);
  }, [isAIChatOpen, clearPanelUrlState, onAIChatOpenChange]);

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
    <ExecutionStatusProvider>
      <Row gap={0} align="stretch" className="relative min-h-0 flex-1">
        <Stack gap={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <SuspenseBoundary fallback={<EditorLoadingSkeleton />}>
            <WorkflowSteps
              hasActiveTrigger={hasActiveTrigger}
              setupIncomplete={setupIncomplete}
              className="flex-1"
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to StepDef shape; component only reads display fields
              steps={steps as StepDef[]}
              onOpenAIChat={handleToggleAIChat}
              isAIChatOpen={isAIChatOpen}
              viewToggle={viewToggle}
            />
          </SuspenseBoundary>
        </Stack>

        {isAIChatOpen && !isUrlSidePanelOpen && (
          <WorkflowAIChatPanel
            workflowSlug={workflowSlug}
            workflowName={workflowSlug}
            organizationId={organizationId}
            onClose={handleCloseAIChat}
            panelWidth={panelWidth}
            onPanelWidthChange={setPanelWidth}
          />
        )}

        {isUrlSidePanelOpen && (
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
  );
}

export function AutomationWorkflowEditorTab({
  organizationId,
  workflowSlug,
  isAIChatOpen,
  onAIChatOpenChange,
  setupIncomplete,
}: {
  organizationId: string;
  workflowSlug: string;
  /** AI Assistant open-state, owned by the detail page (its toggle is in the
   *  tab strip). */
  isAIChatOpen: boolean;
  onAIChatOpenChange: (open: boolean) => void;
  /** Automation setup isn't done — the editor must not claim it's active. */
  setupIncomplete?: boolean;
}) {
  const { t } = useT('automations');
  const { data: readResult, isLoading } = useReadWorkflow(
    organizationId,
    workflowSlug,
  );
  const config = readResult && readResult.ok ? readResult.config : undefined;
  const [editorView, setEditorView] = useWorkflowEditorView();

  if (isLoading) {
    return <EditorLoadingSkeleton />;
  }

  if (!config) {
    return (
      <EmptyState
        title={t('editor.notFoundTitle')}
        description={t('editor.notFoundDescription')}
      />
    );
  }

  const viewToggle = (
    <EditorViewToggle view={editorView} onViewChange={setEditorView} />
  );

  return (
    <Stack gap={0} className="min-h-0 flex-1">
      {editorView === 'specification' ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <WorkflowSpecification
            organizationId={organizationId}
            workflowSlug={workflowSlug}
          />
          <EditorViewFloatingBar>{viewToggle}</EditorViewFloatingBar>
        </div>
      ) : (
        <WorkflowConfigProvider
          workflowSlug={workflowSlug}
          initialConfig={config}
        >
          <EditorCanvas
            organizationId={organizationId}
            workflowSlug={workflowSlug}
            viewToggle={viewToggle}
            isAIChatOpen={isAIChatOpen}
            onAIChatOpenChange={onAIChatOpenChange}
            setupIncomplete={setupIncomplete}
          />
        </WorkflowConfigProvider>
      )}
    </Stack>
  );
}
