// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The row exists so a run that has FINISHED keeps its step timeline
// reachable from the task — the subject panel's Details goes away with the
// live run. Pinned here: every state gets a badge and Details, and the dialog
// speaks in the past tense once nothing is moving.

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
  return render(
    <TaskAutomationRunEntry
      organizationId="org_1"
      projectId="project_1"
      run={run(status)}
      name="Swiss VAT return desk"
    />,
  );
}

describe('TaskAutomationRunEntry', () => {
  it('a finished run keeps its state and a Details entry', async () => {
    renderEntry('success');
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(
      screen.getByRole('heading', {
        name: 'Swiss VAT return desk — run details',
      }),
    ).toBeInTheDocument();
  });

  it('a failed run is offered the same way — failure is what the reader debugs', () => {
    renderEntry('failed');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('a live run reads in the present tense', async () => {
    renderEntry('running');
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(
      screen.getByRole('heading', { name: 'Swiss VAT return desk — progress' }),
    ).toBeInTheDocument();
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
