// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The row keeps the latest run's state visible. Run output is read in the
// activity thread beside the run that produced it.

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'run.details') return 'Details';
      if (key === 'run.detailsTitle') {
        return `${String(values?.name)} — run details`;
      }
      if (key === 'run.detailsTitleLive') {
        return `${String(values?.name)} — progress`;
      }
      if (key === 'runs.status.success') return 'Succeeded';
      if (key === 'runs.status.failed') return 'Failed';
      if (key === 'runs.status.running') return 'Running';
      return key;
    },
  }),
}));

vi.mock('@tale/ui/responsive-dialog', () => ({
  ResponsiveDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  ResponsiveDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResponsiveDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

// The dialog resolves the run and its document version once open; this test
// owns the row and the title, not the timeline's reading.
vi.mock('@/app/features/automations/hooks/queries', () => ({
  useAutomationRun: () => ({ data: undefined }),
  useAutomation: () => ({ data: undefined }),
}));

import {
  TaskAutomationRunEntry,
  isLiveAutomationRun,
} from './task-automation-run-entry';

function run(status: 'success' | 'failed' | 'running') {
  return {
    runId: 'run_1',
    name: 'vat-return-desk',
    status,
    version: 8,
  } as const;
}

function renderEntry(status: 'success' | 'failed' | 'running') {
  return render(<TaskAutomationRunEntry run={run(status)} />);
}

describe('TaskAutomationRunEntry', () => {
  it('a finished run keeps its state without duplicating the result', () => {
    renderEntry('success');
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Details' }),
    ).not.toBeInTheDocument();
  });

  it('a failed run keeps its state without duplicating the result', () => {
    renderEntry('failed');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Details' }),
    ).not.toBeInTheDocument();
  });

  it('a live run keeps its state without opening a duplicate panel', () => {
    renderEntry('running');
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Details' }),
    ).not.toBeInTheDocument();
  });

  it('only queued, running and waiting count as live', () => {
    for (const status of ['queued', 'running', 'waiting'] as const) {
      expect(isLiveAutomationRun({ ...run('running'), status })).toBe(true);
    }
    for (const status of ['success', 'failed', 'cancelled'] as const) {
      expect(isLiveAutomationRun({ ...run('success'), status })).toBe(false);
    }
  });
});
