'use client';

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import {
  type FlowShownState,
  FlowNodeStatusBadge,
} from '@tale/ui/flow/node-status';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { useId, useState } from 'react';

import type {
  NodeRunPage,
  RecordedStep,
} from '@/app/lib/backend/contract/automations';
import type { ViewStatus } from '@/lib/engine/core/record/types';
import { useT } from '@/lib/i18n/client';

import { useRunItems, useRunNode } from '../hooks/queries';
import { nodeTitle } from '../lib/node-face';
import { stepFailureText } from '../lib/run-failure';
import { RunStepData } from './run-step-data';

type Unit = NodeRunPage['units'][number];

/** A unit's status as the canvas words it. */
const STATE: Readonly<Record<ViewStatus, FlowShownState>> = {
  pending: 'pending',
  running: 'running',
  waiting: 'waiting',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
  stopped: 'stopped',
  not_run: 'not-run',
  reused: 'reused',
};

/** A page of units, its cursor, and the one after it. */
function UnitPage({
  organizationId,
  runId,
  node,
  cursor,
  failedOnly,
  selected,
  onSelect,
  onMore,
}: {
  organizationId: string;
  runId: string;
  node: string;
  cursor: string | undefined;
  failedOnly: boolean;
  selected: Unit | null;
  onSelect: (unit: Unit) => void;
  /** The cursor of the page after this one, when it is the last shown. */
  onMore?: (next: string) => void;
}) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const page = useRunItems(organizationId, runId, {
    node,
    ...(cursor !== undefined && { cursor }),
    status: failedOnly ? 'failed' : 'all',
  });
  const units = page.data?.units ?? [];
  return (
    <>
      {units.map((unit) => {
        const label =
          unit.item >= 0
            ? t('items.item', { index: unit.item + 1 })
            : t('items.pass', { index: unit.pass });
        const failure =
          unit.failure === undefined
            ? undefined
            : stepFailureText(unit.failure, { t, locale }).title;
        const isSelected =
          selected !== null &&
          selected.item === unit.item &&
          selected.pass === unit.pass;
        return (
          <li key={`${unit.item}:${unit.pass}`}>
            <button
              type="button"
              aria-pressed={isSelected}
              className="hover:bg-muted/50 focus-visible:ring-ring aria-pressed:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => onSelect(unit)}
            >
              <span className="w-24 shrink-0 font-medium">{label}</span>
              <FlowNodeStatusBadge state={STATE[unit.status]} />
              {failure !== undefined && (
                <span className="text-muted-foreground min-w-0 truncate text-xs">
                  {failure}
                </span>
              )}
            </button>
          </li>
        );
      })}
      {onMore !== undefined &&
        page.data?.next !== null &&
        page.data?.next !== undefined && (
          <li>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = page.data?.next;
                if (typeof next === 'string') onMore(next);
              }}
            >
              {t('items.more')}
            </Button>
          </li>
        )}
    </>
  );
}

/**
 * The items of a step that ran once per item, or the passes of one that
 * repeated: each with how it ended and, when it failed, why — failed ones
 * alone on request — and the one picked read whole below.
 */
export function RunStepItems({
  organizationId,
  runId,
  step,
}: {
  organizationId: string;
  runId: string;
  step: RecordedStep;
}) {
  const { t } = useT('automationRuns');
  const filterId = useId();
  const [failedOnly, setFailedOnly] = useState(false);
  // The cursors of the pages shown after the first.
  const [cursors, setCursors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Unit | null>(null);
  const detail = useRunNode(
    organizationId,
    selected === null ? undefined : runId,
    selected === null
      ? undefined
      : {
          node: step.path,
          ...(selected.item >= 0 && { item: selected.item }),
          ...(selected.pass >= 0 && { pass: selected.pass }),
        },
  );
  const counts = step.counts;
  if (counts === undefined) return null;
  const pages = [undefined, ...cursors];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="p" className="text-xs font-medium">
          {counts.passes === undefined
            ? t('items.items', { count: counts.items })
            : t('items.passes', { count: counts.passes })}
          {counts.failed > 0 &&
            ` · ${t('items.failedCount', { count: counts.failed })}`}
        </Text>
        {counts.failed > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={filterId}
              checked={failedOnly}
              onCheckedChange={(checked) => {
                setFailedOnly(checked === true);
                setCursors([]);
                setSelected(null);
              }}
            />
            <label htmlFor={filterId} className="text-xs">
              {t('items.failedOnly')}
            </label>
          </div>
        )}
      </div>
      {counts.kept < counts.items && (
        <Text as="p" variant="muted" className="text-xs">
          {t('items.keptHint')}
        </Text>
      )}
      <ul
        aria-label={t('items.label', { step: nodeTitle(step.nodeId) })}
        className="flex max-h-64 flex-col overflow-y-auto"
      >
        {pages.map((cursor, index) => (
          <UnitPage
            key={cursor ?? 'first'}
            organizationId={organizationId}
            runId={runId}
            node={step.path}
            cursor={cursor}
            failedOnly={failedOnly}
            selected={selected}
            onSelect={setSelected}
            {...(index === pages.length - 1 && {
              onMore: (next: string) => setCursors((all) => [...all, next]),
            })}
          />
        ))}
      </ul>
      {selected !== null &&
        detail.data !== null &&
        detail.data !== undefined && <RunStepData detail={detail.data} />}
    </section>
  );
}
