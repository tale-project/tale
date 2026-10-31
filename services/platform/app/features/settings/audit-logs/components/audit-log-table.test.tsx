import { describe, expect, it, vi } from 'vitest';

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
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
  action = 'automation.trigger.paused',
) {
  const log: AuditLogDoc = {
    _id: 'log-paused',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org-1',
    actorId: 'system',
    actorType: 'system',
    action,
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
        loadMoreFailed: false,
        errorCount: 0,
      }}
      revealLogId={log._id}
      revealNonce={1}
    />,
  );
}

describe('AuditLogTable action labels', () => {
  it.each([
    ['governance_policy.created', 'Policy created'],
    ['governance_policy.updated', 'Policy updated'],
  ])('names a policy change (%s) in words', async (action, label) => {
    renderDetails({}, 'security', action);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
  });
});

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

/** One audit row, revealed in the detail dialog. */
function renderLog(overrides: Partial<AuditLogDoc>) {
  const log: AuditLogDoc = {
    _id: 'log-agent',
    _creationTime: 1_700_000_000_000,
    organizationId: 'org-1',
    actorId: 'user-ada',
    actorEmail: 'ada@example.com',
    actorRole: 'developer',
    // An MCP write is recorded under the key holder, through the API door.
    actorType: 'api',
    action: 'automation.version.saved',
    category: 'workflow',
    resourceType: 'automation',
    resourceName: 'invoice-intake',
    timestamp: 1_700_000_000_000,
    status: 'success',
    ...overrides,
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
        loadMoreFailed: false,
        errorCount: 0,
      }}
      revealLogId={log._id}
      revealNonce={1}
    />,
  );
}

/** The value a detail row shows beside its label. */
function detailValue(dialog: HTMLElement, label: string) {
  return within(dialog).getByText(label).nextElementSibling?.textContent;
}

describe('AuditLogTable rows a coding agent wrote', () => {
  it('names the coding agent and its client instead of repeating them in Metadata', async () => {
    // Ada saved a version from Claude Code: the MCP door stamped the row with
    // the channel, the tool and her key.
    renderLog({
      metadata: {
        version: 7,
        via: 'mcp',
        tool: 'save_automation',
        apiKeyId: 'key-ada-laptop',
        clientName: 'Claude Code',
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(detailValue(dialog, 'Source')).toBe('Coding agent');
    expect(detailValue(dialog, 'Client')).toBe('Claude Code');
    const metadata = dialog.querySelector('pre');
    expect(metadata).toHaveTextContent('save_automation');
    expect(metadata).toHaveTextContent('key-ada-laptop');
    expect(metadata).not.toHaveTextContent('"via"');
    expect(metadata).not.toHaveTextContent('clientName');
    await checkAccessibility(dialog);
  });

  it('places the source and the client right after the person who acted', async () => {
    renderLog({
      metadata: { via: 'mcp', clientName: 'Claude Code' },
    });
    const dialog = await screen.findByRole('dialog');
    // A row's label is the cell with its value beside it.
    const labels = within(dialog)
      .getAllByText(/^(User|Role|Source|Client|Category)$/)
      .filter((cell) => cell.nextElementSibling !== null)
      .map((label) => label.textContent);
    expect(labels).toEqual(['User', 'Role', 'Source', 'Client', 'Category']);
    expect(detailValue(dialog, 'Role')).toBe('Developer');
  });

  it('shows no client row for a client that never named itself', async () => {
    renderLog({ metadata: { via: 'mcp', tool: 'deploy_automation' } });
    const dialog = await screen.findByRole('dialog');
    expect(detailValue(dialog, 'Source')).toBe('Coding agent');
    expect(within(dialog).queryByText('Client')).not.toBeInTheDocument();
  });

  it('shows a client name through the display rule, never its control or bidi marks', async () => {
    renderLog({
      metadata: {
        via: 'mcp',
        clientName: `Claude\u202E edoC\u0007\n${'x'.repeat(200)}`,
      },
    });
    const dialog = await screen.findByRole('dialog');
    const shown = detailValue(dialog, 'Client') ?? '';
    expect(shown).toMatch(/^Claude edoC x+…$/);
    expect(Array.from(shown)).toHaveLength(80);
    expect(shown).not.toMatch(/[\u202E\u0007\n]/);
  });

  it('leaves a door the channel never writes in Metadata', async () => {
    // Skills record their own publish door; it is not a coding agent.
    renderLog({
      action: 'skill.published',
      category: 'skill',
      metadata: { via: 'upload' },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Source')).not.toBeInTheDocument();
    expect(dialog.querySelector('pre')).toHaveTextContent('"via": "upload"');
  });

  it('keeps an AI row formatted when the channel fields are taken out', async () => {
    renderLog({
      category: 'ai',
      metadata: { via: 'mcp', clientName: 'Codex', model: 'test-model' },
    });
    const dialog = await screen.findByRole('dialog');
    expect(detailValue(dialog, 'Client')).toBe('Codex');
    expect(within(dialog).getByText('test-model')).toBeInTheDocument();
    expect(within(dialog).queryByText('Metadata')).not.toBeInTheDocument();
  });
});

/** The listing the tab hands the table, settled in the state a test names. */
function listing(
  overrides: Partial<UsePaginatedQueryReturnType<AuditLogDoc>> = {},
): UsePaginatedQueryReturnType<AuditLogDoc> {
  return {
    results: [],
    status: 'Exhausted',
    isLoading: false,
    loadMore: vi.fn(),
    error: null,
    retry: vi.fn(),
    isRetrying: false,
    unavailable: false,
    loadMoreFailed: false,
    errorCount: 0,
    ...overrides,
  };
}

// Ada's sign-in, as one row of either trail.
const loggedRow: AuditLogDoc = {
  _id: 'log-sign-in',
  _creationTime: 1_700_000_000_000,
  organizationId: 'org-1',
  actorId: 'user-ada',
  actorEmail: 'ada@example.com',
  actorType: 'user',
  action: 'auth.sign_in',
  category: 'auth',
  resourceType: 'session',
  timestamp: 1_700_000_000_000,
  status: 'failure',
  errorMessage: 'Invalid password',
};

// A compliance reviewer reads an empty trail as "nothing happened", so a
// read that failed must never pass for one (#4834).
describe.each([
  {
    variant: 'audit',
    emptyTitle: 'No audit logs',
    listName: 'Audit logs',
    refreshFailed:
      "Couldn't load the latest audit logs. What's listed may be incomplete or out of date.",
  },
  {
    variant: 'errors',
    emptyTitle: 'No error logs',
    listName: 'Error logs',
    refreshFailed:
      "Couldn't load the latest error logs. What's listed may be incomplete or out of date.",
  },
] as const)(
  'AuditLogTable $variant read failures',
  ({ variant, emptyTitle, listName, refreshFailed }) => {
    it('names a failed first page instead of an empty trail, and Try again recovers it', async () => {
      const retry = vi.fn();
      const { user, rerender } = render(
        <AuditLogTable
          variant={variant}
          paginatedResult={listing({
            error: new Error('synthetic 503'),
            unavailable: true,
            errorCount: 1,
            retry,
          })}
        />,
      );
      expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /^Something went wrong/ }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledTimes(1);
      // The retry asks for the first page again: the table loads, and the
      // focus Try again held waits on the list, not on the page.
      rerender(
        <AuditLogTable
          variant={variant}
          paginatedResult={listing({
            status: 'LoadingFirstPage',
            isLoading: true,
            isRetrying: true,
            unavailable: true,
            errorCount: 1,
            retry,
          })}
        />,
      );
      expect(document.activeElement).toHaveAccessibleName(listName);
      expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
      rerender(
        <AuditLogTable
          variant={variant}
          paginatedResult={listing({ results: [loggedRow], errorCount: 1 })}
        />,
      );
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    });

    it('still says the trail is empty when the read answered with no rows', () => {
      render(<AuditLogTable variant={variant} paginatedResult={listing()} />);
      expect(screen.getByText(emptyTitle)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    });

    it('keeps the loaded rows when a later page fails, names the failure and retries that page', async () => {
      const retry = vi.fn();
      const { user } = render(
        <AuditLogTable
          variant={variant}
          paginatedResult={listing({
            results: [loggedRow],
            status: 'CanLoadMore',
            error: new Error('next page 503'),
            errorCount: 1,
            retry,
          })}
        />,
      );
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(refreshFailed);
      expect(
        screen.getByText(/the rest couldn't be loaded/),
      ).toBeInTheDocument();
      expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledTimes(1);
    });
  },
);
