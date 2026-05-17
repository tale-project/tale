import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';
import { motion, useReducedMotion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const easeOut = [0.22, 1, 0.36, 1] as const;

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
  /** Tier name shown in the sticky column header. */
  name: ReactNode;
  /** Pre-styled CTA element rendered below the tier name. */
  cta: ReactNode;
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
  /** Tier definitions, rendered as sticky column headers (left → right). */
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
  const reduceMotion = useReducedMotion();
  const colCount = tiers.length + 1;
  const [isStuck, setIsStuck] = useState(false);
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsStuck(!entry.isIntersecting);
      },
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10%' }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { delay: 0.08, duration: 0.6, ease: easeOut }
      }
      className="mx-auto mt-12 max-w-[1120px]"
    >
      <div ref={sentinelRef} aria-hidden className="h-0" />
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-[34%] sm:w-[28%]" />
          {tiers.map((tier) => (
            <col key={tier.key} className="w-[22%] sm:w-[24%]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              scope="col"
              className="text-fg-muted px-3 py-4 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
            />
            {tiers.map((tier) => (
              <th
                key={tier.key}
                scope="col"
                className="text-fg-base sticky top-16 p-0 text-center align-top"
              >
                <div className="relative px-2 py-4 sm:px-6 sm:py-6">
                  <div
                    aria-hidden
                    className={`from-bg-elevated via-bg-elevated/80 to-bg-base/0 pointer-events-none absolute inset-0 bg-linear-to-b transition-opacity duration-300 ease-out ${
                      isStuck ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <div className="relative flex flex-col items-stretch gap-4">
                    <span
                      className="text-fg-muted text-base font-medium sm:text-lg"
                      style={{ letterSpacing: '-0.18px' }}
                    >
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
                    className="text-fg-muted px-3 pt-8 pb-4 text-left text-base font-medium sm:px-6"
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
                  className={`transition-colors ${
                    isHovered ? 'bg-bg-elevated/60' : ''
                  }`}
                >
                  <th
                    scope="row"
                    className="text-fg-base border-border-base border px-3 py-4 text-left align-middle text-sm font-medium sm:px-6"
                  >
                    {row.label}
                  </th>
                  <td
                    colSpan={colCount - 1}
                    className="text-fg-muted border-border-base border px-3 py-4 text-center align-middle text-sm sm:px-6"
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
                className={`transition-colors ${
                  isHovered ? 'bg-bg-elevated/60' : ''
                }`}
              >
                <th
                  scope="row"
                  className="text-fg-base border-border-base border px-3 py-4 text-left align-middle text-sm font-medium sm:px-6"
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
                      className="text-fg-muted border-border-base border px-2 py-4 text-center align-middle text-sm whitespace-pre-line sm:px-6"
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
    </motion.div>
  );
}
