import { describe, expect, it, vi } from 'vitest';

import type { AuditLogDoc } from '@/app/lib/backend/contract/docs';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { AuditLogTable } from './audit-log-table';

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined, isLoading: false }),
}));

const pauseMetadata = {
  consecutiveFailures: 3,
  pauseAfter: 3,
  lastFailureCode: 'permanent_failure',
  lastFailedRunId: 'run-failed-123',
};

function renderDetails(
  metadata: Record<string, unknown>,
  category: AuditLogDoc['category'] = 'ai',
) {
  const log: AuditLogDoc = {
    _id: 'log-paused',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org-1',
    actorId: 'system',
    actorType: 'system',
    action: 'automation.trigger.paused',
    category,
    resourceType: 'automation_trigger',
    timestamp: 1_700_000_000_000,
    status: 'success',
    metadata,
  };
  return render(
    <AuditLogTable
      paginatedResult={{
        results: [log],
        status: 'Exhausted',
        isLoading: false,
        loadMore: vi.fn(),
        error: null,
        retry: vi.fn(),
        isRetrying: false,
        unavailable: false,
        errorCount: 0,
      }}
      revealLogId={log._id}
      revealNonce={1}
    />,
  );
}

describe('AuditLogTable metadata details', () => {
  it('shows the paused schedule failure context and run reference', async () => {
    renderDetails(pauseMetadata);
    const dialog = await screen.findByRole('dialog');
    for (const [key, value] of Object.entries(pauseMetadata)) {
      expect(dialog).toHaveTextContent(key);
      expect(dialog).toHaveTextContent(String(value));
    }
    expect(
      within(dialog).queryByText('AI usage details'),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText('Metadata')).toBeInTheDocument();
  });

  it('preserves the security-category metadata control', async () => {
    renderDetails(pauseMetadata, 'security');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('lastFailedRunId');
    expect(dialog).toHaveTextContent('run-failed-123');
    expect(
      within(dialog).queryByText('AI usage details'),
    ).not.toBeInTheDocument();
  });

  it('preserves formatted AI usage without duplicating it in Metadata', async () => {
    renderDetails({
      model: 'test-model',
      provider: 'test-provider',
      inputTokens: 42,
      outputTokens: 7,
      totalTokens: 49,
      costEstimateCents: 12,
      durationMs: 1500,
      agentSlug: 'test-agent',
      toolNames: ['test-tool'],
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('AI usage details')).toBeInTheDocument();
    expect(within(dialog).getByText('test-model')).toBeInTheDocument();
    expect(within(dialog).getByText('42')).toBeInTheDocument();
    expect(within(dialog).getByText('7')).toBeInTheDocument();
    expect(within(dialog).getByText('49')).toBeInTheDocument();
    expect(within(dialog).getByText('test-provider')).toBeInTheDocument();
    expect(within(dialog).getByText('$0.1200')).toBeInTheDocument();
    expect(within(dialog).getByText('1,500 ms')).toBeInTheDocument();
    expect(within(dialog).getByText('test-agent')).toBeInTheDocument();
    expect(within(dialog).getByText('test-tool')).toBeInTheDocument();
    expect(within(dialog).queryByText('Metadata')).not.toBeInTheDocument();
  });

  it('shows diagnostics alongside usage and keeps the dialog accessible', async () => {
    const { user } = renderDetails({
      ...pauseMetadata,
      model: 'test-model',
      inputTokens: 0,
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('run-failed-123');
    expect(within(dialog).getByText('test-model')).toBeInTheDocument();
    expect(within(dialog).getByText('0')).toBeInTheDocument();
    expect(dialog.querySelector('pre')).not.toHaveTextContent('inputTokens');
    await checkAccessibility(dialog);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    { effectsCount: 2, executions: { step: 1 } },
    { approvalsWithdrawn: 4 },
    { mode: 'live', runStatus: 'cancelled' },
  ])('shows other automation metadata: %j', async (metadata) => {
    renderDetails(metadata);
    const dialog = await screen.findByRole('dialog');
    for (const key of Object.keys(metadata))
      expect(dialog).toHaveTextContent(key);
  });

  it('redacts secrets in newly exposed metadata, including nested arrays', async () => {
    renderDetails({
      ...pauseMetadata,
      apiKey: 'hidden-api-key',
      context: {
        password: 'hidden-password',
        attempts: [{ accessToken: 'hidden-token' }],
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('run-failed-123');
    expect(dialog).toHaveTextContent('[REDACTED]');
    expect(dialog).not.toHaveTextContent('hidden-api-key');
    expect(dialog).not.toHaveTextContent('hidden-password');
    expect(dialog).not.toHaveTextContent('hidden-token');
  });

  it('does not render empty metadata sections', async () => {
    renderDetails({});
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByText('AI usage details'),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Metadata')).not.toBeInTheDocument();
  });

  it('keeps unformatted AI fields in the generic fallback', async () => {
    renderDetails({
      costEstimateCents: 'unpriced',
      durationMs: null,
      toolNames: [],
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('unpriced');
    expect(dialog).toHaveTextContent('durationMs');
    expect(dialog).toHaveTextContent('toolNames');
    expect(
      within(dialog).queryByText('AI usage details'),
    ).not.toBeInTheDocument();
  });
});
