import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { Reveal } from '@/app/components/marketing/reveal';

export function LabelWithInfo({
  label,
  info,
}: {
  label: string;
  info: string;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={info}
              className="text-fg-muted hover:text-fg-base focus-visible:ring-accent-base/30 inline-flex h-4 w-4 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
            >
              <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-center">
            {info}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

export interface CompareTier<TK extends string> {
  key: TK;
  /** Tier name shown in the column header. */
  name: ReactNode;
  /** Pre-styled CTA element rendered below the tier name. */
  cta: ReactNode;
  /**
   * Soft frosted column header (translucent inset + blur). On software
   * pricing this marks Community; the recommended Enterprise column
   * stays crisp raised white.
   */
  emphasized?: boolean;
}

export interface CompareDataRow<TK extends string> {
  kind: 'data';
  label: ReactNode;
  /** Stable string used for React keys (label may be a ReactNode). */
  rowKey?: string;
  /**
   * Cell content per tier. A missing entry means the cell is omitted from
   * this row — used together with `cellSpans` to vertically merge cells.
   */
  cells: Partial<Record<TK, ReactNode>>;
  /** Optional rowSpan per tier — values > 1 merge that cell with the next rows. */
  cellSpans?: Partial<Record<TK, number>>;
}

export interface CompareSpanRow {
  kind: 'span';
  label: string;
  content: ReactNode;
}

export interface CompareSectionRow {
  kind: 'section';
  label: string;
}

export type CompareRow<TK extends string> =
  | CompareDataRow<TK>
  | CompareSpanRow
  | CompareSectionRow;

interface CompareTableProps<TK extends string> {
  /** Screen-reader-only caption for the leading column. */
  caption: string;
  /** Tier definitions, rendered as column headers (left → right). */
  tiers: CompareTier<TK>[];
  /** Section / span / data rows. */
  rows: CompareRow<TK>[];
}

/**
 * Comparison table shared between pricing-compare and hardware-compare.
 */
export function CompareTable<TK extends string>({
  caption,
  tiers,
  rows,
}: CompareTableProps<TK>) {
  const colCount = tiers.length + 1;
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);

  // Map every row index to a hover group: rows linked by a `cellSpans` value
  // greater than 1 share a group, so hovering either highlights both.
  const rowGroupByIndex = useMemo(() => {
    const groups: number[] = [];
    let next = 0;
    for (let i = 0; i < rows.length; i++) {
      if (groups[i] !== undefined) continue;
      groups[i] = next;
      const row = rows[i];
      if (row.kind === 'data' && row.cellSpans) {
        const spans = Object.values(row.cellSpans).filter(
          (v): v is number => typeof v === 'number',
        );
        const maxSpan = spans.length === 0 ? 1 : Math.max(1, ...spans);
        for (let j = 1; j < maxSpan; j++) {
          if (i + j < rows.length) groups[i + j] = next;
        }
      }
      next++;
    }
    return groups;
  }, [rows]);

  return (
    <Reveal delay={0.08} className="mx-auto mt-12 max-w-[1120px]">
      <div className="border-border-base/40 bg-surface-site-raised overflow-hidden rounded-2xl border">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col
              className={tiers.length === 1 ? 'w-1/2' : 'w-[34%] sm:w-[28%]'}
            />
            {tiers.map((tier) => (
              <col
                key={tier.key}
                className={tiers.length === 1 ? 'w-1/2' : 'w-[22%] sm:w-[24%]'}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-border-base/40 border-b p-0 text-left align-bottom"
              >
                <div className="px-3 py-4 sm:px-6 sm:py-5" />
              </th>
              {tiers.map((tier, tierIndex) => (
                <th
                  key={tier.key}
                  scope="col"
                  className="text-fg-base border-border-base/40 border-b p-0 text-center align-top"
                >
                  <div
                    className={`relative px-2 py-4 sm:px-5 sm:py-5 ${
                      tier.emphasized
                        ? 'bg-surface-site-inset/30 backdrop-blur-sm'
                        : ''
                    } ${tierIndex > 0 ? 'border-border-base/40 border-l' : ''}`}
                  >
                    <div className="relative flex flex-col items-stretch gap-3">
                      <span className="text-fg-base text-lg font-medium tracking-tight sm:text-xl">
                        {tier.name}
                      </span>
                      {tier.cta}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              if (row.kind === 'section') {
                return (
                  <tr key={`section-${row.label}-${idx}`}>
                    <th
                      colSpan={colCount}
                      scope="colgroup"
                      className="text-fg-muted bg-surface-site-inset/40 px-3 pt-5 pb-2 text-left text-sm font-medium sm:px-6"
                    >
                      {row.label}
                    </th>
                  </tr>
                );
              }

              if (row.kind === 'span') {
                const group = rowGroupByIndex[idx];
                const isHovered = hoveredGroup === group;
                return (
                  <tr
                    key={`span-${row.label}-${idx}`}
                    onMouseEnter={() => setHoveredGroup(group)}
                    onMouseLeave={() => setHoveredGroup(null)}
                    className={`transition-colors motion-reduce:transition-none ${
                      isHovered ? 'bg-surface-site-inset/70' : ''
                    }`}
                  >
                    <th
                      scope="row"
                      className="text-fg-base border-border-base/40 border-t px-3 py-3 text-left align-middle text-sm font-medium sm:px-6"
                    >
                      {row.label}
                    </th>
                    <td
                      colSpan={colCount - 1}
                      className="text-fg-muted border-border-base/40 border-t px-3 py-3 text-center align-middle text-sm sm:px-6"
                    >
                      {row.content}
                    </td>
                  </tr>
                );
              }

              const group = rowGroupByIndex[idx];
              const isHovered = hoveredGroup === group;
              return (
                <tr
                  key={`data-${row.rowKey ?? idx}`}
                  onMouseEnter={() => setHoveredGroup(group)}
                  onMouseLeave={() => setHoveredGroup(null)}
                  className={`transition-colors motion-reduce:transition-none ${
                    isHovered ? 'bg-surface-site-inset/70' : ''
                  }`}
                >
                  <th
                    scope="row"
                    className="text-fg-base border-border-base/40 border-t px-3 py-3 text-left align-middle text-sm font-medium sm:px-6"
                  >
                    {row.label}
                  </th>
                  {tiers.map((tier) => {
                    if (!(tier.key in row.cells)) return null;
                    const span = row.cellSpans?.[tier.key];
                    return (
                      <td
                        key={tier.key}
                        rowSpan={span}
                        className="text-fg-muted border-border-base/40 border-t px-2 py-3 text-center align-middle text-sm whitespace-pre-line sm:px-6"
                      >
                        {row.cells[tier.key]}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Reveal>
  );
}
