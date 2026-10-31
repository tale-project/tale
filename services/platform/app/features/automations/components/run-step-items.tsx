'use client';

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Checkbox } from '@tale/ui/checkbox';
import {
  type FlowShownState,
  FlowNodeStatusBadge,
} from '@tale/ui/flow/node-status';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import type { TFunction } from 'i18next';
import { useId, useRef, useState } from 'react';

import type {
  NodeRunPage,
  RecordedStep,
} from '@/app/lib/backend/contract/automations';
import { readStateOf } from '@/app/lib/backend/read-state';
import type { ViewStatus } from '@/lib/engine/core/record/types';
import { useT } from '@/lib/i18n/client';

import { useRunItems, useRunNode } from '../hooks/queries';
import { nodeTitle } from '../lib/node-face';
import { stepFailureText } from '../lib/run-failure';
import { isUnit, type RunUnitRef, unitRefOf } from '../lib/run-timeline';
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

/** An item or a pass by its number; people count both from 1, the record
 *  from 0. */
function unitLabel(t: TFunction, unit: RunUnitRef): string {
  return unit.item !== undefined
    ? t('items.item', { index: unit.item + 1 })
    : t('items.pass', { index: (unit.pass ?? 0) + 1 });
}

/** A page of units, its cursor, and the one after it. */
function UnitPage({
  organizationId,
  runId,
  node,
  cursor,
  failedOnly,
  passes,
  selected,
  onSelect,
  onMore,
  onFocusLost,
}: {
  organizationId: string;
  runId: string;
  node: string;
  cursor: string | undefined;
  failedOnly: boolean;
  /** The step repeated: its units are passes, not items. */
  passes: boolean;
  selected: RunUnitRef | null;
  onSelect: (unit: Unit) => void;
  /** The cursor of the page after this one, when it is the last shown. */
  onMore?: (next: string) => void;
  /** Takes the focus of a Try again whose page answered with no unit. */
  onFocusLost: () => void;
}) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const page = useRunItems(organizationId, runId, {
    node,
    ...(cursor !== undefined && { cursor }),
    status: failedOnly ? 'failed' : 'all',
  });
  // A page that failed says so where its units would be, and keeps saying
  // it while Try again runs; the pages before it are reads of their own.
  const read = readStateOf(page);
  // Try again leaves once the page answers; its first unit takes the focus.
  const firstRef = useRef<HTMLButtonElement>(null);
  const units = page.data?.units ?? [];
  return (
    <>
      {units.map((unit, index) => {
        const label = unitLabel(t, unitRefOf(unit));
        const failure =
          unit.failure === undefined
            ? undefined
            : stepFailureText(unit.failure, { t, locale }).title;
        const isSelected = selected !== null && isUnit(selected, unit);
        return (
          <li key={`${unit.item}:${unit.pass}`}>
            <button
              ref={index === 0 ? firstRef : undefined}
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
      {read.unavailable && (
        <li>
          <CatalogLoadError
            message={t('items.loadFailed', {
              kind: passes ? 'passes' : 'items',
            })}
            onRetry={() => void page.refetch()}
            isRetrying={read.retrying}
            failureKey={read.failureCount}
            onFocusLost={() => {
              if (firstRef.current === null) onFocusLost();
              else firstRef.current.focus();
            }}
          />
        </li>
      )}
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
 * alone on request — and the one picked read whole below. The page may
 * choose the one shown (the Steps view, a link); the list chooses on its
 * own otherwise. A read that fails says so where its answer would be, with
 * Try again, never as a list with nothing more in it.
 */
export function RunStepItems({
  organizationId,
  runId,
  step,
  unit,
  onUnitChange,
}: {
  organizationId: string;
  runId: string;
  step: RecordedStep;
  unit?: RunUnitRef | null;
  onUnitChange?: (unit: RunUnitRef | null) => void;
}) {
  const { t } = useT('automationRuns');
  const filterId = useId();
  const [failedOnly, setFailedOnly] = useState(false);
  // The cursors of the pages shown after the first.
  const [cursors, setCursors] = useState<string[]>([]);
  const [chosen, setChosen] = useState<RunUnitRef | null>(null);
  const selected = unit === undefined ? chosen : unit;
  const select = (next: RunUnitRef | null) => {
    setChosen(next);
    onUnitChange?.(next);
  };
  const detail = useRunNode(
    organizationId,
    selected === null ? undefined : runId,
    selected === null
      ? undefined
      : {
          node: step.path,
          ...(selected.item !== undefined && { item: selected.item }),
          ...(selected.pass !== undefined && { pass: selected.pass }),
        },
  );
  const data = detail.data ?? undefined;
  const detailRead = readStateOf(detail);
  // Where the focus goes when a Try again leaves while it holds it: the
  // list, and the picked item's data.
  const listRef = useRef<HTMLUListElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
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
                select(null);
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
        ref={listRef}
        tabIndex={-1}
        aria-label={t('items.label', { step: nodeTitle(step.nodeId) })}
        className="flex max-h-64 flex-col overflow-y-auto outline-none"
      >
        {pages.map((cursor, index) => (
          <UnitPage
            key={cursor ?? 'first'}
            organizationId={organizationId}
            runId={runId}
            node={step.path}
            cursor={cursor}
            failedOnly={failedOnly}
            passes={counts.passes !== undefined}
            selected={selected}
            onSelect={(picked) => select(unitRefOf(picked))}
            {...(index === pages.length - 1 && {
              onMore: (next: string) => setCursors((all) => [...all, next]),
            })}
            onFocusLost={() => listRef.current?.focus()}
          />
        ))}
      </ul>
      {selected !== null && (data !== undefined || detailRead.unavailable) && (
        <div
          ref={dataRef}
          role="group"
          aria-label={unitLabel(t, selected)}
          tabIndex={-1}
          className="outline-none"
        >
          {data === undefined ? (
            <CatalogLoadError
              message={t('items.dataLoadFailed', {
                kind: selected.item === undefined ? 'pass' : 'item',
              })}
              onRetry={() => void detail.refetch()}
              isRetrying={detailRead.retrying}
              failureKey={detailRead.failureCount}
              onFocusLost={() => dataRef.current?.focus()}
            />
          ) : (
            <RunStepData detail={data} />
          )}
        </div>
      )}
    </section>
  );
}
