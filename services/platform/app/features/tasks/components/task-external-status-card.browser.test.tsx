import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { TaskStatusSnapshot } from '@/backend/domains/tasks/external-status';
import { i18n } from '@/lib/i18n/i18n';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { TaskExternalStatusCard } from './task-external-status-card';

import '@/app/globals.css';

const io = vi.hoisted(() => ({
  snapshot: null as TaskStatusSnapshot | null,
  submit: vi.fn(),
  retry: vi.fn(),
  failed: false,
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: io.snapshot,
    isError: io.failed,
    refetch: io.retry,
  }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: io.submit, isPending: false }),
}));

function snapshot(): TaskStatusSnapshot {
  return {
    task: {
      id: 'source-task',
      status: 'in_review',
      externalSystem: 'quality-service',
      externalId: 'ticket:7',
    },
    revision: '41',
    statusChangedAt: 100,
    change: null,
    externalStatus: {
      sourceRevision: 'source:1',
      sourceStatusAt: 100,
      status: 'in_review',
      archived: false,
    },
    request: null,
    workflow: {
      actions: [
        {
          id: 'verify',
          title: 'Verify first result',
          i18n: {
            de: { title: 'Erstes Ergebnis prüfen' },
            fr: { title: 'Vérifier le premier résultat' },
          },
          status: 'in_review',
          fields: [
            {
              key: 'note',
              label: 'Verification result',
              type: 'text',
              required: true,
              multiline: true,
              pattern: '^[\\s\\S]{1,2000}$',
              i18n: {
                de: { label: 'Prüfergebnis' },
                fr: { label: 'Résultat de la vérification' },
              },
            },
          ],
        },
        {
          id: 'reopen',
          title: 'Reopen with a reason',
          status: 'in_review',
          fields: [
            {
              key: 'reason',
              label: 'Reopening reason',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
    },
  };
}
function Card({ canWork = true }: { canWork?: boolean }) {
  return (
    <TaskExternalStatusCard
      organizationId="source-org"
      taskId="source-task"
      externalSystem="quality-service"
      canWork={canWork}
    />
  );
}

beforeEach(async () => {
  io.snapshot = snapshot();
  io.failed = false;
  vi.clearAllMocks();
  io.submit.mockResolvedValue(io.snapshot);
  localStorage.setItem('user-locale', 'en');
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
});

describe('source workflow in a real browser', () => {
  it('submits a required same-column action with notes and frozen versions, never a claimed actor', async () => {
    render(<Card />);
    await page.getByRole('button', { name: 'Verify first result' }).click();
    await page.getByRole('button', { name: 'Send request' }).click();
    expect(io.submit).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole('textbox', { name: 'Verification result' }))
      .toHaveFocus();
    await page
      .getByRole('textbox', { name: 'Verification result' })
      .fill('Checked the first result.\nEvidence retained.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await waitFor(() => expect(io.submit).toHaveBeenCalledOnce());
    expect(io.submit.mock.calls[0]?.[0]).toEqual({
      organizationId: 'source-org',
      taskId: 'source-task',
      requestId: expect.any(String),
      expectedRevision: '41',
      expectedSourceRevision: 'source:1',
      actionId: 'verify',
      values: { note: 'Checked the first result.\nEvidence retained.' },
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
  it('preserves typed evidence and submission identity when the server refuses a stale form', async () => {
    io.submit.mockRejectedValue(
      new Error('The source form changed. Reopen it before submitting.'),
    );
    render(<Card />);
    await page.getByRole('button', { name: 'Verify first result' }).click();
    await page
      .getByRole('textbox', { name: 'Verification result' })
      .fill('Evidence still belongs to this form.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect
      .element(
        page.getByText('The source form changed. Reopen it before submitting.'),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole('textbox', { name: 'Verification result' }))
      .toHaveValue('Evidence still belongs to this form.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await waitFor(() => expect(io.submit).toHaveBeenCalledTimes(2));
    expect(io.submit.mock.calls[1]?.[0]).toEqual(io.submit.mock.calls[0]?.[0]);
  });
  it('shows a durable refusal, blocks a second pending action, and offers source-guarded reopen on archived tasks', async () => {
    const state = snapshot();
    state.task.archivedAt = 150;
    io.snapshot = state;
    const view = render(<Card />);
    await page.getByRole('button', { name: 'Reopen with a reason' }).click();
    await expect
      .element(page.getByRole('textbox', { name: 'Reopening reason' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    state.request = {
      id: 'request-1',
      revision: '42',
      statusChangeId: '40',
      actionId: 'reopen',
      status: 'in_review',
      input: { move: 'reopen', reason: 'More evidence' },
      sourceRevision: 'source:1',
      sourceStatusAt: 100,
      createdAt: 200,
      actor: {
        type: 'user',
        userId: 'person-1',
        emailVerified: true,
        activeMember: true,
      },
      decision: null,
    };
    view.rerender(<Card />);
    await expect
      .element(page.getByText('The source is validating your request.'))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Reopen with a reason' }))
      .toBeDisabled();
    state.request.decision = {
      accepted: false,
      reason: 'Only the source reviewer may reopen this record.',
    };
    view.rerender(<Card />);
    await expect
      .element(
        page.getByText('Only the source reviewer may reopen this record.'),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Reopen with a reason' }))
      .toBeEnabled();
    view.rerender(<Card canWork={false} />);
    expect(
      screen.queryByRole('button', { name: 'Reopen with a reason' }),
    ).not.toBeInTheDocument();
  });
  it('keeps localized source fields and dialog keyboard focus usable on a narrow screen', async () => {
    await page.viewport(390, 844);
    for (const [language, action, label, cancel] of [
      ['en', 'Verify first result', 'Verification result', 'Cancel'],
      ['de', 'Erstes Ergebnis prüfen', 'Prüfergebnis', 'Abbrechen'],
      [
        'fr',
        'Vérifier le premier résultat',
        'Résultat de la vérification',
        'Annuler',
      ],
    ]) {
      localStorage.setItem('user-locale', language);
      await i18n.changeLanguage(language);
      const view = render(<Card />);
      await page.getByRole('button', { name: action }).click();
      await expect
        .element(page.getByRole('textbox', { name: label }))
        .toBeVisible();
      await page
        .getByRole('textbox', { name: label })
        .fill('Verified evidence');
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      await page.getByRole('button', { name: action }).click();
      await page.getByRole('button', { name: cancel }).click();
      view.unmount();
    }
    await page.viewport(1280, 800);
  });
});
