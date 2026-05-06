import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

const easeOut = [0.22, 1, 0.36, 1] as const;

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
  cells: Record<TK, ReactNode>;
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
 *
 * Layout:
 *   - Outer `<motion.div>` with the border + scroll-in animation
 *   - `<table>` with one fixed label column + one column per tier
 *   - `<thead>` non-sticky as a row, but the tier `<th>`s individually
 *     stick at top-16 with a frosted background and inset shadow border
 *     (the leftmost label cell scrolls away naturally)
 *   - `<tbody>` supports section headers (`section`), data rows
 *     (`data`, with one cell per tier), and span rows (`span`, with the
 *     value spanning all tier columns)
 */
export function CompareTable<TK extends string>({
  caption,
  tiers,
  rows,
}: CompareTableProps<TK>) {
  const reduceMotion = useReducedMotion();
  const colCount = tiers.length + 1;

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
      className="border-border-base mx-auto mt-12 max-w-[1120px] border"
    >
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
              className="text-fg-muted border-border-base border-b px-3 py-4 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
            />
            {tiers.map((tier) => (
              <th
                key={tier.key}
                scope="col"
                className="bg-bg-base/60 text-fg-base sticky top-16 z-10 px-2 py-4 text-center align-top shadow-[inset_0_0_0_1px_var(--color-border-base)] backdrop-blur-lg sm:px-6 sm:py-6"
              >
                <div className="flex flex-col items-stretch gap-4">
                  <span
                    className="text-fg-muted text-base font-medium sm:text-lg"
                    style={{ letterSpacing: '-0.18px' }}
                  >
                    {tier.name}
                  </span>
                  {tier.cta}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.kind === 'section') {
              return (
                <tr
                  key={`section-${row.label}-${idx}`}
                  className="border-border-base border-b"
                >
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
              return (
                <tr
                  key={`span-${row.label}-${idx}`}
                  className="border-border-base border-b last:border-b-0"
                >
                  <th
                    scope="row"
                    className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                  >
                    {row.label}
                  </th>
                  <td
                    colSpan={colCount - 1}
                    className="border-border-base text-fg-muted border-l px-3 py-4 text-center align-top text-sm sm:px-6"
                  >
                    {row.content}
                  </td>
                </tr>
              );
            }
            return (
              <tr
                key={`data-${row.rowKey ?? idx}`}
                className="border-border-base border-b last:border-b-0"
              >
                <th
                  scope="row"
                  className="text-fg-base px-3 py-4 text-left align-top text-sm font-medium sm:px-6"
                >
                  {row.label}
                </th>
                {tiers.map((tier) => (
                  <td
                    key={tier.key}
                    className="border-border-base text-fg-muted border-l px-2 py-4 text-center align-top text-sm sm:px-6"
                  >
                    {row.cells[tier.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </motion.div>
  );
}
