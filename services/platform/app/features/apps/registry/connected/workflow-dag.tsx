'use client';

/**
 * Connected `WorkflowDag` block — the app's workflow display, which **fully
 * reuses the global automations canvas** (`AutomationSteps`), not a bespoke
 * per-app map, driven by the same `useReadWorkflow` the editor uses. Three modes:
 *  - default: the read-only DAG ("How it works" at a glance).
 *  - `executionId`: overlays live per-node status (a run view).
 *  - `editable`: alongside the canvas, the **reused AI chat panel** — the actual
 *    way to understand AND edit a file-based workflow (the agent reads it and
 *    proposes edits as approval cards; direct canvas manipulation is stubbed
 *    platform-wide). Re-reads on the `workflow-updated` event so an approved edit
 *    repaints the canvas.
 */
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AutomationAIChatPanel } from '@/app/features/automations/components/automation-ai-chat-panel';
import { AutomationSidePanel } from '@/app/features/automations/components/automation-sidepanel';
import {
  AUTOMATION_PANEL_URL_DEFINITIONS,
  AutomationSteps,
} from '@/app/features/automations/components/automation-steps';
import { ExecutionStatusProvider } from '@/app/features/automations/components/execution-status-context';
import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import type {
  StepConfig,
  StepDef,
} from '@/app/features/automations/utils/step-icons';
import { useUrlState } from '@/app/hooks/use-url-state';
import { useT } from '@/lib/i18n/client';
import type { StepType } from '@/lib/shared/schemas/workflows';
import { isRecord } from '@/lib/utils/type-utils';

import { useAppRuntime } from '../../runtime/app-runtime';
import { Section } from './section';

export interface WorkflowDagProps {
  title?: string;
  workflowSlug: string;
  /** When set, overlays live per-node execution status (a run view). */
  executionId?: string;
  /** When true, pairs the canvas with the AI chat panel (understand + edit). */
  editable?: boolean;
}

function workflowNameOf(config: unknown): string | undefined {
  return isRecord(config) && typeof config.name === 'string'
    ? config.name
    : undefined;
}

/** A workflow step as it comes off the (v.any) readWorkflow JSON — the typed
 *  view we project from. `readWorkflow` returns `v.any`, so this single cast (of
 *  the validated-on-disk shape) lets the field reads stay type-clean, mirroring
 *  the automations editor route's projection. */
interface ConfigStep {
  stepSlug: string;
  name?: string;
  description?: string;
  stepType: StepType;
  order?: number;
  nextSteps?: Record<string, string>;
  config?: StepConfig;
}

/** Map the file-based workflow JSON `config.steps` into the canvas `StepDef`
 *  shape — the same projection the automations editor route does. */
function mapSteps(
  config: unknown,
  organizationId: string,
  workflowSlug: string,
): StepDef[] {
  if (!isRecord(config) || !Array.isArray(config.steps)) return [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated on disk; readWorkflow returns v.any
  const steps = config.steps as ConfigStep[];
  return steps
    .filter((step) => typeof step.stepSlug === 'string')
    .map((step, index) => ({
      _id: `${workflowSlug}:${step.stepSlug}`,
      _creationTime: 0,
      organizationId,
      wfDefinitionId: workflowSlug,
      stepSlug: step.stepSlug,
      name: step.name ?? step.stepSlug,
      description: step.description,
      stepType: step.stepType,
      order: step.order ?? index,
      nextSteps: step.nextSteps ?? {},
      config: step.config ?? {},
    }));
}

export function WorkflowDag({
  title,
  workflowSlug,
  executionId,
  editable,
}: WorkflowDagProps) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const read = useReadWorkflow(organizationId, workflowSlug);
  const config = read.data?.ok ? read.data.config : undefined;
  const steps = useMemo(
    () => mapSteps(config, organizationId, workflowSlug),
    [config, organizationId, workflowSlug],
  );
  // No panel is shown by default — the canvas stands alone; the chat opens on
  // the ✨ affordance, the test/step panel on the canvas Test button / node click.
  const [chatOpen, setChatOpen] = useState(false);

  // Step-config / test side panel: same URL-state mechanism the editor uses
  // (AutomationSteps writes panel/step; the side panel reads it). The chat and
  // the side panel are mutually exclusive, mirroring the route.
  const { state: panelState, clearAll: clearPanelUrlState } = useUrlState({
    definitions: AUTOMATION_PANEL_URL_DEFINITIONS,
  });
  const sidePanelOpen =
    panelState.panel === 'test' || panelState.panel === 'step';
  const selectedStep = useMemo(
    () => steps.find((s) => s.stepSlug === panelState.step) ?? null,
    [steps, panelState.step],
  );
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
  const openChat = () => {
    clearPanelUrlState();
    setChatOpen(true);
  };

  // An AI-applied edit dispatches `workflow-updated` (the same bridge the global
  // editor uses); re-read so the embedded canvas repaints the new graph.
  const refetch = read.refetch;
  useEffect(() => {
    if (!editable || !refetch) return undefined;
    const onUpdated = () => void refetch();
    window.addEventListener('workflow-updated', onUpdated);
    return () => window.removeEventListener('workflow-updated', onUpdated);
  }, [editable, refetch]);

  let body: React.ReactNode;
  if (read.error) {
    body = (
      <Text variant="error">
        {t('workflow.error', { error: read.error.message })}
      </Text>
    );
  } else if (read.isLoading && steps.length === 0) {
    body = <SkeletonText lines={4} />;
  } else if (steps.length === 0) {
    body = <Text variant="muted">{t('workflow.none')}</Text>;
  } else if (editable && !executionId) {
    // The editor body: canvas + the reused AI chat panel (understand + edit) +
    // the test / step-config side panel — chat and side panel are mutually
    // exclusive, as in the global editor.
    body = (
      <div className="relative flex h-[32rem] w-full overflow-hidden rounded-md border">
        <AutomationSteps
          steps={steps}
          hasActiveTrigger={false}
          onOpenAIChat={openChat}
        />
        {chatOpen && !sidePanelOpen && (
          <AutomationAIChatPanel
            workflowSlug={workflowSlug}
            workflowName={workflowNameOf(config)}
            organizationId={organizationId}
            onClose={() => setChatOpen(false)}
          />
        )}
        {sidePanelOpen && (
          <AutomationSidePanel
            step={selectedStep}
            isOpen
            onClose={clearPanelUrlState}
            showTestPanel={panelState.panel === 'test'}
            automationId={workflowSlug}
            organizationId={organizationId}
            stepOptions={stepOptions}
          />
        )}
      </div>
    );
  } else {
    // The canvas fills a flex parent; give it a bounded height so it embeds
    // cleanly inside the app page rather than collapsing.
    const canvas = (
      <div className="flex h-[28rem] w-full">
        <AutomationSteps steps={steps} hasActiveTrigger={false} />
      </div>
    );
    body = executionId ? (
      <ExecutionStatusProvider executionId={executionId}>
        {canvas}
      </ExecutionStatusProvider>
    ) : (
      canvas
    );
  }

  return (
    <Section title={title} icon={Workflow}>
      {body}
    </Section>
  );
}
