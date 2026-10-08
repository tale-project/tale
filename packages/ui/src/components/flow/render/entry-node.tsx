'use client';

import type { NodeProps } from '@xyflow/react';
import { Play, TriangleAlert, Info } from 'lucide-react';
import { memo } from 'react';

import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { flowNodeTitle } from '../describe';
import { FLOW_SECTION_ROWS, visibleRows } from '../layout/sizes';
import type { FlowEntryNode, FlowNotice, FlowRow } from '../types';
import { FlowNodeButton, FlowNodeStrip } from './flow-render-context';
import { FlowNodeTitleRow, type FlowNodeData } from './step-node';

/** One line of a Start or End section: icon, words, detail, a state word;
 *  20 px, plus 16 for a note. */
function FlowRowLine({ row }: { row: FlowRow }) {
  const Icon = row.icon;
  return (
    <span className="flex flex-col">
      <span className="flex h-5 items-center gap-1.5 text-xs leading-4">
        {Icon ? (
          <Icon className="text-muted-foreground size-3.5 shrink-0" />
        ) : null}
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          <span
            className={cn(
              'text-foreground max-w-full shrink-0 truncate',
              row.code && 'font-mono',
            )}
          >
            {row.label}
          </span>
          {row.detail && (
            <span className="text-muted-foreground min-w-0 truncate">
              · {row.detail}
            </span>
          )}
        </span>
        {row.badge && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 text-xs leading-4 font-medium',
              row.badge.tone === 'warning'
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {row.badge.label}
          </span>
        )}
      </span>
      {row.note && (
        <span
          className={cn(
            'text-muted-foreground h-4 truncate text-xs leading-4',
            Icon && 'pl-5',
          )}
        >
          {row.note}
        </span>
      )}
    </span>
  );
}

/** A section of Start or End: its heading, at most `max` row slots (the
 *  rest as "+n more"), or one line of words when it has no rows. */
export function FlowNodeSection({
  heading,
  rows,
  max,
  empty,
}: {
  heading: string;
  rows: readonly FlowRow[];
  max: number;
  empty: string;
}) {
  const { t } = useT('flow');
  const { shown, more } = visibleRows(rows, max);
  return (
    <span className="mt-2 flex flex-col">
      <span className="text-muted-foreground mb-1 h-4 text-xs leading-4 font-medium">
        {heading}
      </span>
      {rows.length === 0 ? (
        <span className="text-muted-foreground flex h-5 items-center text-xs">
          {empty}
        </span>
      ) : (
        shown.map((row) => <FlowRowLine key={row.id} row={row} />)
      )}
      {more > 0 && (
        <span className="text-muted-foreground flex h-5 items-center text-xs">
          {t('node.more', { count: more })}
        </span>
      )}
    </span>
  );
}

/** A warning or a note at the foot of Start or End: one line, 28 px. */
export function FlowNodeNotice({ notice }: { notice: FlowNotice }) {
  const Icon = notice.tone === 'warning' ? TriangleAlert : Info;
  return (
    <span className="mt-2 flex h-7 items-center gap-1.5 text-xs leading-4">
      <Icon
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0',
          notice.tone === 'warning'
            ? 'text-amber-700 dark:text-amber-500'
            : 'text-muted-foreground',
        )}
      />
      <span className="text-foreground truncate" title={notice.text}>
        {notice.text}
      </span>
    </span>
  );
}

/**
 * Start: what starts a run (triggers in words) and what each run receives
 * (its input fields), above everything else. Its strip names the nodes it
 * leads to.
 */
export const FlowEntryNodeView = memo(function FlowEntryNodeView({
  data,
}: NodeProps & { data: FlowNodeData<FlowEntryNode> }) {
  const { t } = useT('flow');
  const { node, phase } = data;
  return (
    <FlowNodeButton
      id={node.id}
      phase={phase}
      className="bg-card text-card-foreground border-border flex flex-col rounded-lg border shadow-sm"
    >
      <span className="flex min-h-0 flex-1 flex-col px-3 pt-3">
        <FlowNodeTitleRow
          id={node.id}
          icon={Play}
          title={flowNodeTitle(node, t)}
        />
        {node.triggers.length > 0 && (
          <FlowNodeSection
            heading={t('node.triggers')}
            rows={node.triggers}
            max={FLOW_SECTION_ROWS.triggers}
            empty=""
          />
        )}
        <FlowNodeSection
          heading={t('node.inputs')}
          rows={node.inputs}
          max={FLOW_SECTION_ROWS.inputs}
          empty={node.inputsEmpty ?? t('node.noInput')}
        />
        {node.notice && <FlowNodeNotice notice={node.notice} />}
      </span>
      <FlowNodeStrip id={node.id} />
    </FlowNodeButton>
  );
});
