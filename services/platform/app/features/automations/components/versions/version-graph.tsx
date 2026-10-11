'use client';

import { diffHighlight, mergeFlowGraphs } from '@tale/ui/flow/diff';
import type { FlowRow } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Hand } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AutomationDiff } from '@/lib/engine/core/diff/automation';
import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { useCanvasFlow } from '../../hooks/use-canvas-flow';
import type { NodeCatalogView } from '../../lib/node-face';
import { flowNodeChanges } from '../../lib/version-changes';
import type { CompareLabels } from './version-changes';

/** Nobody checks a stored version again here: the graph is its shape. */
const NO_CHECK = { status: 'off', analysis: null, types: null } as const;

type Side = 'changes' | 'before' | 'after';

function isSide(value: string): value is Side {
  return value === 'changes' || value === 'before' || value === 'after';
}

/**
 * Two versions of an automation on one chart: every node of the later
 * version and the nodes only the earlier one had, each marked added,
 * removed, changed (with what changed) or renamed, and the lines only one
 * version draws. **v4** and **v5** show either version's own chart with
 * what changed brought forward. Triggers belong to the automation, not to a
 * version, so Start says only that a run can be started by hand.
 */
export function VersionGraph({
  automationSlug,
  before,
  after,
  diff,
  labels,
  catalog,
  selectedId,
  onSelect,
}: {
  automationSlug: string;
  /** The earlier version's document; null when the later is the first. */
  before: Automation | null;
  after: Automation;
  diff: AutomationDiff;
  labels: CompareLabels;
  catalog: NodeCatalogView;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const [side, setSide] = useState<Side>('changes');
  const manualOnly = useMemo<readonly FlowRow[]>(
    () => [
      { id: 'trigger:manual', icon: Hand, label: t('canvas.start.manual') },
    ],
    [t],
  );
  const afterFlow = useCanvasFlow({
    automation: after,
    catalog,
    triggers: manualOnly,
    check: NO_CHECK,
  });
  // The first version is compared with nothing: an empty document stands in
  // for the earlier one, and only the later one's chart is drawn.
  const emptyBefore = useMemo<Automation>(
    () => ({ ...after, nodes: [] }),
    [after],
  );
  const beforeFlow = useCanvasFlow({
    automation: before ?? emptyBefore,
    catalog,
    triggers: manualOnly,
    check: NO_CHECK,
  });
  const marks = useMemo(
    () => flowNodeChanges(diff, { t, locale }),
    [diff, t, locale],
  );
  const merged = useMemo(
    () =>
      before === null
        ? null
        : mergeFlowGraphs(beforeFlow.graph, afterFlow.graph, (id) =>
            marks.get(id),
          ),
    [before, beforeFlow.graph, afterFlow.graph, marks],
  );

  if (merged === null) {
    return (
      <WorkflowCanvas
        graph={afterFlow.graph}
        aria-label={labels.after}
        layoutKey={`${automationSlug}:compare:${labels.after}`}
        framed
        selectedId={selectedId}
        onSelect={onSelect}
      />
    );
  }

  const own = side === 'before' ? beforeFlow.graph : afterFlow.graph;
  return (
    <WorkflowCanvas
      graph={side === 'changes' ? merged.graph : own}
      {...(side === 'changes'
        ? { diff: merged.diff }
        : { highlight: diffHighlight(own, merged.diff) })}
      aria-label={
        side === 'changes'
          ? t('compare.graph.ariaLabel', {
              from: labels.before,
              to: labels.after,
            })
          : side === 'before'
            ? labels.before
            : labels.after
      }
      layoutKey={`${automationSlug}:compare:${labels.before}..${labels.after}:${side}`}
      framed
      selectedId={selectedId}
      onSelect={onSelect}
      topStart={
        <SegmentedControl
          aria-label={t('compare.graph.side')}
          value={side}
          onValueChange={(next) => {
            if (isSide(next)) setSide(next);
          }}
          options={[
            { value: 'changes', label: t('compare.side.changes') },
            { value: 'before', label: labels.before },
            { value: 'after', label: labels.after },
          ]}
        />
      }
    />
  );
}
