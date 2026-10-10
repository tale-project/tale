'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { JsonViewer } from '@tale/ui/json-viewer';
import { Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';

import type {
  NodeRunDetail,
  RecordedStep,
} from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import type { RunUnitRef } from '../lib/run-timeline';
import { shortRunId, type NodeRunView } from '../lib/run-view';
import { EffectList } from './effect-list';
import { RunStatusBadge } from './run-status-badge';
import { RunStepAttempts } from './run-step-attempts';
import { RunStepConditions } from './run-step-conditions';
import { RunStepData } from './run-step-data';
import { RunStepFailure } from './run-step-failure';
import { RunStepItems } from './run-step-items';

/** A step as the run's record keeps it, and where to read more of it. */
export interface RunStepRecord {
  organizationId: string;
  runId: string;
  /** Why it ran or not, and its items or passes. */
  step?: RecordedStep;
  /** What it read, received and returned. */
  detail?: NodeRunDetail;
  /** The item or pass shown, when the page chooses it (the Steps view, a
   *  link); its list chooses on its own when left out. */
  unit?: RunUnitRef | null;
  onUnitChange?: (unit: RunUnitRef | null) => void;
}

/**
 * What ONE step of a run did: its status, why it was skipped or how it failed,
 * the input it resolved to, the value it produced, and the effects it
 * performed. The single rendering of a `NodeRunView` — the automation editor's
 * node inspector shows it under a node's fields, and the task modal's run
 * dialog shows it for the step the reader picked, so the two surfaces can
 * never drift into describing the same run differently.
 */
export function RunStepDetail({
  runView,
  record,
  heading,
  badge,
}: {
  runView: NodeRunView;
  /** The step as the run's record keeps it. Its data takes the place of
   *  the trace's input and output. */
  record?: RunStepRecord;
  /** Section title: the run dialog names the step. The inspector's Last
   *  run tab already says what this is, so it gives none. */
  heading?: string;
  /** Extra mark beside the status — the run dialog uses it to say THIS is the
   * step the run is on, so the reader knows the detail below is live. */
  badge?: string;
}) {
  const { t } = useT('automations');
  return (
    <Stack gap={3}>
      <div className="flex flex-wrap items-center gap-2">
        {heading !== undefined && (
          <SectionHeader as="h4" size="sm" title={heading} />
        )}
        <RunStatusBadge status={runView.status} />
        {badge !== undefined && (
          <Badge variant="outline" className="text-[10px]">
            {badge}
          </Badge>
        )}
        {runView.type !== undefined && (
          <Text as="span" variant="muted" className="font-mono text-[11px]">
            {runView.type}
          </Text>
        )}
      </div>
      {/* The record says why in words; the trace's own English is what a
          run without one has. */}
      {record?.step?.failure !== undefined ? (
        <RunStepFailure failure={record.step.failure} />
      ) : (
        runView.error !== undefined && (
          <Alert variant="destructive" description={runView.error} />
        )
      )}
      {record?.step !== undefined && <RunStepConditions step={record.step} />}
      {record?.step !== undefined && <RunStepAttempts step={record.step} />}
      {record?.step?.counts !== undefined && (
        <RunStepItems
          organizationId={record.organizationId}
          runId={record.runId}
          step={record.step}
          {...(record.unit !== undefined && { unit: record.unit })}
          {...(record.onUnitChange !== undefined && {
            onUnitChange: record.onUnitChange,
          })}
        />
      )}
      {record?.step === undefined && runView.note !== undefined && (
        <Text as="p" variant="muted" className="text-xs text-pretty">
          {runView.note}
        </Text>
      )}
      {record?.detail !== undefined && (
        <RunStepData
          detail={record.detail}
          fileStem={`run-${shortRunId(record.runId)}-${record.detail.nodeId}`}
        />
      )}
      {record?.detail === undefined && runView.input !== undefined && (
        <div>
          <Text as="p" className="mb-1 text-xs font-medium">
            {t('editor.resolvedInput')}
          </Text>
          <JsonViewer data={runView.input} collapsed={1} />
        </div>
      )}
      {record?.detail === undefined && runView.output !== undefined && (
        <div>
          <Text as="p" className="mb-1 text-xs font-medium">
            {t('editor.output')}
          </Text>
          <JsonViewer data={runView.output} collapsed={1} />
        </div>
      )}
      <EffectList
        effects={runView.effects}
        // A step still in flight has performed nothing YET — asserting it
        // "changed nothing" would be a verdict on a run still being written.
        emptyMessage={
          runView.status === 'running' ||
          runView.status === 'waiting' ||
          runView.status === 'interrupted'
            ? t('runs.effects.noneYetForNode')
            : t('runs.effects.noneForNode')
        }
      />
    </Stack>
  );
}
