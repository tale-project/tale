'use client';

import { Box, Flag, Play, RefreshCw, Repeat } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import type { IssueCounts } from '../feedback/issue-summary';
import { describeFlowGraph, flowListFormat, type FlowWords } from './describe';
import {
  FlowNodeIssueMarker,
  flowNodeIssueFrameClass,
} from './node-issue-marker';
import type { FlowGraph, FlowGroup, FlowNode } from './types';

export interface FlowStepListProps {
  graph: FlowGraph;
  /** The list's name; "Nodes" in the session's language when left out. */
  'aria-label'?: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Problem counts by node id. */
  issues?: ReadonlyMap<string, IssueCounts>;
  /** The region a row's button opens (an inspector), if the host has one. */
  controlsId?: string;
  className?: string;
}

const NO_ISSUES: IssueCounts = { errors: 0, warnings: 0 };

type Item =
  | { kind: 'node'; node: FlowNode }
  | { kind: 'frame'; group: FlowGroup; nodes: FlowNode[] };

/** Nodes in reading order, conditions folded into the step they guard,
 *  each frame's members under it. */
function itemsOf(graph: FlowGraph): Item[] {
  const groupOf = new Map<string, FlowGroup>();
  for (const group of graph.groups ?? [])
    for (const member of group.members) groupOf.set(member, group);
  const items: Item[] = [];
  for (const node of graph.nodes) {
    if (node.kind === 'gate') continue;
    const group = groupOf.get(node.id);
    const last = items.at(-1);
    if (group === undefined) items.push({ kind: 'node', node });
    else if (last?.kind === 'frame' && last.group.id === group.id)
      last.nodes.push(node);
    else items.push({ kind: 'frame', group, nodes: [node] });
  }
  return items;
}

function iconOf(node: FlowNode) {
  if (node.kind === 'entry') return Play;
  if (node.kind === 'exit') return Flag;
  if (node.kind === 'step') return node.icon ?? Box;
  return Box;
}

/**
 * The chart as a list — its text alternative, and the List view of a
 * workflow canvas: Start, every node in reading order, End, as an ordered
 * list of buttons. Each row says what the node is and, under it, what it
 * reads, when it runs (its condition folded in) and where it leads; members
 * of a frame sit indented under the frame's words. One Tab stop: ↑ and ↓
 * move between rows, Home and End jump, Enter or Space opens a row.
 */
export function FlowStepList({
  graph,
  'aria-label': ariaLabel,
  selectedId = null,
  onSelect,
  issues,
  controlsId,
  className,
}: FlowStepListProps) {
  const { t } = useT('flow');
  const { t: tIssues } = useT('issues');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const baseId = useId();
  const words = useMemo(
    () =>
      describeFlowGraph(graph, {
        t,
        tIssues,
        list: flowListFormat(locale),
        issues,
      }),
    [graph, t, tIssues, locale, issues],
  );
  const items = useMemo(() => itemsOf(graph), [graph]);
  const order = useMemo(
    () =>
      items.flatMap((item) =>
        item.kind === 'node'
          ? [item.node.id]
          : item.nodes.map((node) => node.id),
      ),
    [items],
  );
  const [focused, setFocused] = useState<string | null>(null);
  const tabStop =
    [selectedId, focused].find((id) => id !== null && order.includes(id)) ??
    order[0] ??
    null;
  const listRef = useRef<HTMLOListElement>(null);

  const move = (from: string, event: KeyboardEvent<HTMLButtonElement>) => {
    const at = order.indexOf(from);
    const next =
      event.key === 'ArrowDown'
        ? order[at + 1]
        : event.key === 'ArrowUp'
          ? order[at - 1]
          : event.key === 'Home'
            ? order[0]
            : event.key === 'End'
              ? order.at(-1)
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    listRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-flow-row="${CSS.escape(next)}"]`,
      )
      ?.focus();
  };

  if (order.length === 0) {
    return (
      <p className={cn('text-muted-foreground p-4 text-sm', className)}>
        {t('list.empty')}
      </p>
    );
  }

  const row = (node: FlowNode): ReactNode => (
    <FlowListRow
      key={node.id}
      node={node}
      words={words}
      baseId={baseId}
      selected={selectedId === node.id}
      tabbable={tabStop === node.id}
      counts={issues?.get(node.id) ?? NO_ISSUES}
      controlsId={controlsId}
      onActivate={() => onSelect?.(selectedId === node.id ? null : node.id)}
      onKeyDown={(event) => move(node.id, event)}
      onFocus={() => setFocused(node.id)}
    />
  );

  return (
    <ol
      ref={listRef}
      aria-label={ariaLabel ?? t('list.label')}
      className={cn('flex flex-col gap-1 p-3', className)}
    >
      {items.map((item) =>
        item.kind === 'node' ? (
          row(item.node)
        ) : (
          <li key={item.group.id} className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 text-xs font-medium">
              {item.group.kind === 'repeat' ? (
                <RefreshCw aria-hidden="true" className="size-3.5 shrink-0" />
              ) : (
                <Repeat aria-hidden="true" className="size-3.5 shrink-0" />
              )}
              {item.group.label}
            </span>
            <ol className="border-border ml-3 flex flex-col gap-1 border-l border-dashed pl-2">
              {item.nodes.map(row)}
            </ol>
          </li>
        ),
      )}
    </ol>
  );
}

function FlowListRow({
  node,
  words,
  baseId,
  selected,
  tabbable,
  counts,
  controlsId,
  onActivate,
  onKeyDown,
  onFocus,
}: {
  node: FlowNode;
  words: FlowWords;
  baseId: string;
  selected: boolean;
  tabbable: boolean;
  counts: IssueCounts;
  controlsId?: string;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
}) {
  const Icon = iconOf(node);
  const lines = words.lines.get(node.id) ?? [];
  const linesId = `${baseId}-lines-${node.id}`;
  const disclosure = controlsId !== undefined;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        data-flow-row={node.id}
        tabIndex={tabbable ? 0 : -1}
        aria-label={words.names.get(node.id)}
        aria-describedby={lines.length > 0 ? linesId : undefined}
        aria-pressed={disclosure ? undefined : selected}
        aria-expanded={disclosure ? selected : undefined}
        aria-controls={disclosure && selected ? controlsId : undefined}
        onClick={onActivate}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className={cn(
          'hover:bg-muted/60 flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left',
          'ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
          flowNodeIssueFrameClass(counts),
          selected && 'bg-muted ring-ring ring-2',
        )}
      >
        <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-md">
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {words.titles.get(node.id)}
          </span>
          {node.kind === 'step' && node.typeLabel && (
            <span className="text-muted-foreground block truncate text-xs">
              {node.typeLabel}
            </span>
          )}
        </span>
        <FlowNodeIssueMarker
          errors={counts.errors}
          warnings={counts.warnings}
        />
      </button>
      {lines.length > 0 && (
        <span
          id={linesId}
          className="text-muted-foreground flex flex-col pr-2 pl-9 text-xs leading-5"
        >
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      )}
    </li>
  );
}
