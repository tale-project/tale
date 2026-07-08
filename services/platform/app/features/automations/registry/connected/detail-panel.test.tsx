// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundQueryResult } from '../../hooks/use-bound-query';
import type { BoundActionSpec } from './bound-button';
import { DetailPanel } from './detail-panel';

// i18n → echo `automations.<key>`.
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

// Deterministic date formatting — the real hook needs locale providers.
vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (d: Date, preset?: string) => `dt:${d.getTime()}:${preset}`,
  }),
}));

// BoundButton pulls the dispatch stack; capture what the panel binds instead.
const boundButtonCalls: { action: BoundActionSpec; item: unknown }[] = [];
vi.mock('./bound-button', () => ({
  BoundButton: ({
    action,
    item,
  }: {
    action: BoundActionSpec;
    item?: Record<string, unknown>;
  }) => {
    boundButtonCalls.push({ action, item });
    return <button type="button">{action.label ?? action.path}</button>;
  },
}));

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

const QUERY = { path: 'tasks/queries:getTask', args: { id: '$state.taskId' } };

const RECORD = {
  name: 'Ada',
  status: 'completed',
  createdAt: 1_700_000_000_000,
  count: 1234,
  url: 'https://example.com/x',
  note: 'javascript-free plain text',
  nested: { deep: 'yes' },
};

afterEach(() => {
  boundButtonCalls.length = 0;
});

describe('DetailPanel — field kinds', () => {
  it('renders a <dl> of literal labels and scalar values (dot-paths too)', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[
          { labelKey: 'Name', field: 'name' },
          { labelKey: 'Deep', field: 'nested.deep' },
        ]}
      />,
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('yes')).toBeInTheDocument();
  });

  it('formats datetime fields through the platform date formatter', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Created', field: 'createdAt', kind: 'datetime' }]}
      />,
    );

    expect(screen.getByText('dt:1700000000000:long')).toBeInTheDocument();
  });

  it('renders badge fields via the shared status map', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Status', field: 'status', kind: 'badge' }]}
      />,
    );

    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('renders http(s) link fields as safe external anchors', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'URL', field: 'url', kind: 'link' }]}
      />,
    );

    const anchor = screen.getByRole('link', { name: RECORD.url });
    expect(anchor).toHaveAttribute('href', RECORD.url);
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noreferrer');
  });

  it('keeps a non-URL link value as inert text', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Note', field: 'note', kind: 'link' }]}
      />,
    );

    expect(screen.getByText(RECORD.note)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('formats number fields with locale separators', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Count', field: 'count', kind: 'number' }]}
      />,
    );

    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('dashes missing values and never dumps objects', () => {
    queryReturn = bound({ data: RECORD });

    render(
      <DetailPanel
        query={QUERY}
        fields={[
          { labelKey: 'Missing', field: 'absent' },
          { labelKey: 'Object', field: 'nested' },
        ]}
      />,
    );

    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('DetailPanel — frame and states', () => {
  it('defaults the frame title and mounts actions bound to the record', () => {
    queryReturn = bound({ data: RECORD });
    const action: BoundActionSpec = {
      label: 'Close task',
      path: 'tasks/mutations:closeTask',
      mode: 'mutation',
    };

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Name', field: 'name' }]}
        actions={[action]}
      />,
    );

    expect(screen.getByText('automations.detail.title')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close task' }),
    ).toBeInTheDocument();
    expect(boundButtonCalls[0]?.item).toBe(RECORD);
  });

  it('hides actions until the record is loaded', () => {
    queryReturn = bound({ data: null });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Name', field: 'name' }]}
        actions={[
          {
            label: 'Close',
            path: 'tasks/mutations:closeTask',
            mode: 'mutation',
          },
        ]}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
  });

  it('surfaces the blocked state', () => {
    queryReturn = bound({ blocked: true });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Name', field: 'name' }]}
      />,
    );

    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
  });

  it('reads an unresolved $state binding as awaiting selection', () => {
    queryReturn = bound({ needsConfig: true });

    render(
      <DetailPanel
        query={QUERY}
        fields={[{ labelKey: 'Name', field: 'name' }]}
      />,
    );

    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
  });

  it('prompts to configure when a non-state binding is unresolved', () => {
    queryReturn = bound({ needsConfig: true });

    render(
      <DetailPanel
        query={{ path: QUERY.path, args: { repo: '$config:repo' } }}
        fields={[{ labelKey: 'Name', field: 'name' }]}
      />,
    );

    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
  });
});
