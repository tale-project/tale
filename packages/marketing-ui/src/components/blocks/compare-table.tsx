import { Popover } from '@tale/ui/popover';
import { HelpCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { Reveal } from '../marketing/reveal';

export function LabelWithInfo({
  label,
  info,
}: {
  label: string;
  info: string;
}): ReactNode {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Popover
        aria-label={label}
        side="top"
        align="start"
        contentClassName="max-w-[min(20rem,calc(100vw-2rem))] rounded-xl text-sm leading-relaxed"
        trigger={
          <button
            type="button"
            aria-label={label}
            className="text-fg-muted hover:text-fg-base hover:bg-surface-site-inset focus-visible:ring-accent-base inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
          >
            <HelpCircle aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        }
      >
        {info}
      </Popover>
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
      {/* On a phone the table lays out on its content (`table-auto`) and the
          card scrolls sideways when that is wider than the screen — a spec
          such as "64GB (DDR5 ECC)" does not break, and four fixed columns at
          320px cut it off inside a clipping card. From `sm` the designed
          fixed columns hold. `relative`: the sr-only caption is laid out
          against the scrolling card, not a box outside it. */}
      <div className="border-border-base/40 bg-surface-site-raised relative overflow-x-auto rounded-2xl border">
        <table className="w-full table-auto border-collapse sm:table-fixed">
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
