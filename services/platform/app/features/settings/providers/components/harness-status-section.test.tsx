// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { HarnessStatus } from '../hooks/queries';
import { HarnessStatusSection } from './harness-status-section';

/**
 * Component coverage for the harness status section: rows render
 * the managed verdict (pool + default, or the unavailability reason), a
 * subscription badge names its provider and flags an inert binding, and the
 * health signal marks a degraded harness. The derivation itself is covered
 * by the convex-side `harness_status.test.ts`; the hooks are stubbed at the
 * module boundary.
 */

const fixtures = vi.hoisted(() => ({
  status: [] as unknown[],
  health: [] as unknown[],
  statusError: null as Error | null,
  refetchStatus: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  harnessStatusQueryKey: (organizationId: string) => [
    'providers',
    'harness-status',
    organizationId,
  ],
  useHarnessStatus: () => ({
    data: fixtures.statusError === null ? fixtures.status : undefined,
    isPending: false,
    isError: fixtures.statusError !== null,
    error: fixtures.statusError,
    refetch: fixtures.refetchStatus,
  }),
  useHarnessHealth: () => ({
    data: fixtures.health,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const ROWS: HarnessStatus[] = [
  {
    slug: 'claude-code',
    label: 'Claude Code',
    managed: {
      available: true,
      modelCount: 2,
      defaultModelId: 'deepseek/deepseek-v3.2',
    },
    subscriptions: [{ providerSlug: 'zai', usable: true }],
  },
  {
    slug: 'cursor',
    label: 'Cursor',
    managed: { available: false, reason: 'byo-only' },
    subscriptions: [],
  },
  {
    slug: 'opencode',
    label: 'OpenCode',
    managed: { available: false, reason: 'no-direct-credential' },
    subscriptions: [{ providerSlug: 'nous', usable: false }],
  },
];

const DISPLAY_NAMES = new Map([
  ['zai', 'Z.ai'],
  ['nous', 'Nous Portal'],
]);

function renderSection() {
  return render(
    <HarnessStatusSection
      organizationId="org-1"
      displayNames={DISPLAY_NAMES}
    />,
  );
}

describe('HarnessStatusSection', () => {
  it('shows the managed verdict with the pool and the fallback default', () => {
    fixtures.status = ROWS;
    fixtures.health = [];
    fixtures.statusError = null;

    renderSection();

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Managed')).toBeInTheDocument();
    expect(
      screen.getByText('2 models · default deepseek/deepseek-v3.2'),
    ).toBeInTheDocument();
  });

  it('explains an unavailable managed lane with its reason', () => {
    fixtures.status = ROWS;
    fixtures.health = [];
    fixtures.statusError = null;

    renderSection();

    expect(
      screen.getByText(
        "Needs its own vendor credential — platform-managed keys can't run it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No directly usable provider credential yet — add an API key or an environment credential above.',
      ),
    ).toBeInTheDocument();
  });

  it('names a subscription by provider and flags the inert binding', () => {
    fixtures.status = ROWS;
    fixtures.health = [];
    fixtures.statusError = null;

    renderSection();

    expect(screen.getByText('Subscription · Z.ai')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Subscription · Nous Portal — not usable, this harness runs managed credentials only',
      ),
    ).toBeInTheDocument();
  });

  it('marks a harness the health signal flags as failing', () => {
    fixtures.status = ROWS;
    fixtures.health = [
      {
        harness: 'claude-code',
        recentTotal: 5,
        recentFailures: 4,
        degraded: true,
      },
    ];
    fixtures.statusError = null;

    renderSection();

    expect(screen.getByText('Recently failing')).toBeInTheDocument();
  });

  it('surfaces a listing failure instead of an empty success state', () => {
    fixtures.status = [];
    fixtures.health = [];
    fixtures.statusError = new Error('nope');

    renderSection();

    expect(
      screen.getByText("Couldn't load the agent status."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    fixtures.status = ROWS;
    fixtures.health = [];
    fixtures.statusError = null;

    const { container } = renderSection();
    await waitFor(() => checkAccessibility(container));
  });
});
