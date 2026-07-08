// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { BoundQueryResult } from '../../hooks/use-bound-query';
import { formatStatValue, getValueAtPath, StatGrid } from './stat-grid';

// i18n → echo `automations.<key>` so assertions read clearly.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`,
  }),
}));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

// Trend/sparkline leaves → prop-capturing stubs (their internals are covered
// by the @tale/ui suites); presence/wiring is what this block owns.
vi.mock('@tale/ui/trend-indicator', () => ({
  TrendIndicator: ({
    value,
    previous,
  }: {
    value: number;
    previous: number | null;
  }) => <span data-testid="trend">{`${value}:${String(previous)}`}</span>,
}));
vi.mock('@tale/ui/sparkline', () => ({
  Sparkline: ({ data }: { data: number[] }) => (
    <span data-testid="sparkline">{data.join(',')}</span>
  ),
}));

// The bound query — driven by hand per test.
let queryReturn: BoundQueryResult;
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => queryReturn,
}));

function bound(over: Partial<BoundQueryResult>): BoundQueryResult {
  return {
    data: undefined,
    isLoading: false,
    error: undefined,
    blocked: false,
    needsConfig: false,
    ...over,
  };
}

const QUERY = { path: 'tasks/queries:getTaskStats', args: { org: '$orgId' } };

describe('getValueAtPath', () => {
  it('traverses dot-notation paths', () => {
    expect(
      getValueAtPath(
        { countsByStatus: { in_progress: 3 } },
        'countsByStatus.in_progress',
      ),
    ).toBe(3);
  });

  it('prefers a literal key containing dots', () => {
    expect(getValueAtPath({ 'a.b': 1, a: { b: 2 } }, 'a.b')).toBe(1);
  });

  it('returns undefined for missing segments and non-records', () => {
    expect(getValueAtPath({ a: { b: 2 } }, 'a.c')).toBeUndefined();
    expect(getValueAtPath({ a: 5 }, 'a.b')).toBeUndefined();
    expect(getValueAtPath(null, 'a')).toBeUndefined();
  });
});

describe('formatStatValue', () => {
  it('formats plain numbers with locale separators', () => {
    expect(formatStatValue(1234, undefined, 'en')).toBe('1,234');
  });

  it('formats percent from a 0–100 value', () => {
    expect(formatStatValue(42, 'percent', 'en')).toBe('42%');
  });

  it('formats cents as currency', () => {
    expect(formatStatValue(1234, 'cents', 'en')).toBe('$12.34');
  });

  it('formats durations at a readable unit', () => {
    expect(formatStatValue(500, 'duration', 'en')).toBe('500ms');
    expect(formatStatValue(90_000, 'duration', 'en')).toBe('1.5m');
    expect(formatStatValue(5_400_000, 'duration', 'en')).toBe('1.5h');
  });

  it('passes strings through and dashes non-numbers', () => {
    expect(formatStatValue('already', 'number', 'en')).toBe('already');
    expect(formatStatValue(undefined, 'number', 'en')).toBe('—');
    expect(formatStatValue(Number.NaN, 'number', 'en')).toBe('—');
  });
});

describe('StatGrid', () => {
  it('renders literal labels and formatted values, including dot-paths', () => {
    queryReturn = bound({
      data: { total: 1234, countsByStatus: { in_progress: 3 } },
    });

    render(
      <StatGrid
        query={QUERY}
        stats={[
          { labelKey: 'Total', valueField: 'total' },
          {
            labelKey: 'WIP',
            valueField: 'countsByStatus.in_progress',
          },
        ]}
      />,
    );

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('WIP')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows trend and sparkline only for stats that declare the fields', () => {
    queryReturn = bound({
      data: { total: 10, prevTotal: 8, series: [1, 2, 3], other: 5 },
    });

    render(
      <StatGrid
        query={QUERY}
        stats={[
          {
            labelKey: 'Total',
            valueField: 'total',
            trendField: 'prevTotal',
            sparklineField: 'series',
          },
          { labelKey: 'Other', valueField: 'other' },
        ]}
      />,
    );

    expect(screen.getByTestId('trend')).toHaveTextContent('10:8');
    expect(screen.getByTestId('sparkline')).toHaveTextContent('1,2,3');
    expect(screen.getAllByTestId('trend')).toHaveLength(1);
    expect(screen.getAllByTestId('sparkline')).toHaveLength(1);
  });

  it('surfaces the blocked state when the path is not allowlisted', () => {
    queryReturn = bound({ blocked: true });

    render(
      <StatGrid query={QUERY} stats={[{ labelKey: 'A', valueField: 'a' }]} />,
    );

    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
  });

  it('prompts to configure when a non-state binding is unresolved', () => {
    queryReturn = bound({ needsConfig: true });

    render(
      <StatGrid
        query={{ path: QUERY.path, args: { repo: '$config:repo' } }}
        stats={[{ labelKey: 'A', valueField: 'a' }]}
      />,
    );

    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
  });

  it('reads an unresolved $state binding as awaiting selection', () => {
    queryReturn = bound({ needsConfig: true });

    render(
      <StatGrid
        query={{ path: QUERY.path, args: { taskId: '$state.taskId' } }}
        stats={[{ labelKey: 'A', valueField: 'a' }]}
      />,
    );

    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
  });

  it('degrades to the shared empty notice on null data (no-access query)', () => {
    queryReturn = bound({ data: null });

    render(
      <StatGrid query={QUERY} stats={[{ labelKey: 'A', valueField: 'a' }]} />,
    );

    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
  });
});
