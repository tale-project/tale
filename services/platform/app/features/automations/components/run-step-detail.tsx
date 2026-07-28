'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';

import type { NodeRunView } from '../lib/run-view';
import { EffectList } from './effect-list';
import { RunStatusBadge } from './run-status-badge';

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
  heading,
  badge,
}: {
  runView: NodeRunView;
  /** Section title; the inspector says "Run", the run dialog names the step. */
  heading: string;
  /** Extra mark beside the status — the run dialog uses it to say THIS is the
   * step the run is on, so the reader knows the detail below is live. */
  badge?: string;
}) {
  const { t } = useT('automations');
  return (
    <Stack gap={3}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionHeader as="h4" size="sm" title={heading} />
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
      {runView.error !== undefined && (
        <Alert variant="destructive" description={runView.error} />
      )}
      {runView.note !== undefined && (
        <Text as="p" variant="muted" className="text-xs text-pretty">
          {runView.note}
        </Text>
      )}
      {runView.input !== undefined && (
        <div>
          <Text as="p" className="mb-1 text-xs font-medium">
            {t('editor.resolvedInput')}
          </Text>
          <JsonViewer data={runView.input} collapsed={1} />
        </div>
      )}
      {runView.output !== undefined && (
        <div>
          <Text as="p" className="mb-1 text-xs font-medium">
            {t('editor.output')}
          </Text>
          <JsonViewer data={runView.output} collapsed={1} />
        </div>
      )}
      <EffectList
        effects={runView.effects}
        emptyMessage={t('runs.effects.noneForNode')}
      />
    </Stack>
  );
}
