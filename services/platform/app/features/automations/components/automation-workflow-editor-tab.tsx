'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
/**
 * The automation detail page's "Editor" tab — the automation's workflow
 * (`manifest.workflows[0]`), rendered with the SAME components the standalone
 * `/dashboard/$id/workflows/$workflowId` route uses: `WorkflowConfigProvider`
 * + `WorkflowSteps` (the canvas) + `WorkflowSidePanel` (step config / test
 * run) + `WorkflowAIChatPanel` (the canvas assistant). A Graph/Specification
 * pill toggle (W5b) sits above both views — `useWorkflowEditorView` persists
 * the choice in a cookie shared across every workflow, layered under an
 * optional `?view=` URL override.
 */
import { Tabs } from '@tale/ui/tabs';
import { lazy, useCallback, useMemo, useState } from 'react';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
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

/** Canvas + side panels — mounted once the workflow config is loaded, inside
 *  `WorkflowConfigProvider` so `useWorkflowConfig` resolves. */
function EditorCanvas({
  organizationId,
  workflowSlug,
}: {
  organizationId: string;
  workflowSlug: string;
}) {
  const { locale } = useLocale();
  const { config } = useWorkflowConfig();
  const { hasActiveTrigger } = useWorkflowActivity(
    organizationId,
    workflowSlug,
  );
  const [isAIChatOpen, setIsAIChatOpen] = useState(true);
  const [panelWidth, setPanelWidth] = usePersistedState(
    'workflow-side-panel-width',
    384,
  );
  const { state: panelState, clearAll: clearPanelUrlState } = useUrlState({
    definitions: WORKFLOW_PANEL_URL_DEFINITIONS,
  });
  const isUrlSidePanelOpen =
    panelState.panel === 'test' || panelState.panel === 'step';

  const handleCloseAIChat = useCallback(() => setIsAIChatOpen(false), []);
  const handleOpenAIChat = useCallback(() => {
    clearPanelUrlState();
    setIsAIChatOpen(true);
  }, [clearPanelUrlState]);

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
          <SuspenseBoundary
            fallback={
              <Skeletonize loading className="contents">
                <SkeletonText lines={10} />
              </Skeletonize>
            }
          >
            <WorkflowSteps
              hasActiveTrigger={hasActiveTrigger}
              className="flex-1"
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- file-based steps mapped to StepDef shape; component only reads display fields
              steps={steps as StepDef[]}
              onOpenAIChat={handleOpenAIChat}
            />
          </SuspenseBoundary>
        </Stack>

        {isAIChatOpen && !isUrlSidePanelOpen && (
          <WorkflowAIChatPanel
            workflowSlug={workflowSlug}
            workflowName={config.name}
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
}: {
  organizationId: string;
  workflowSlug: string;
}) {
  const { t } = useT('automations');
  const { t: tWorkflows } = useT('workflows');
  const { data: readResult, isLoading } = useReadWorkflow(
    organizationId,
    workflowSlug,
  );
  const config = readResult && readResult.ok ? readResult.config : undefined;
  const [editorView, setEditorView] = useWorkflowEditorView();

  if (isLoading) {
    return (
      <Skeletonize loading className="contents">
        <SkeletonText lines={10} />
      </Skeletonize>
    );
  }

  if (!config) {
    return (
      <EmptyState
        title={t('editor.notFoundTitle')}
        description={t('editor.notFoundDescription')}
      />
    );
  }

  return (
    <Stack gap={0} className="min-h-0 flex-1">
      <Tabs
        variant="pill"
        value={editorView}
        onValueChange={(value) =>
          setEditorView(value === 'specification' ? 'specification' : 'graph')
        }
        listAriaLabel={tWorkflows('editorView.ariaLabel')}
        className="shrink-0 px-3 pt-3"
        items={[
          { value: 'graph', label: tWorkflows('editorView.graph') },
          {
            value: 'specification',
            label: tWorkflows('editorView.specification'),
          },
        ]}
      />
      {editorView === 'specification' ? (
        <WorkflowSpecification
          organizationId={organizationId}
          workflowSlug={workflowSlug}
        />
      ) : (
        <WorkflowConfigProvider
          workflowSlug={workflowSlug}
          initialConfig={config}
        >
          <EditorCanvas
            organizationId={organizationId}
            workflowSlug={workflowSlug}
          />
        </WorkflowConfigProvider>
      )}
    </Stack>
  );
}
