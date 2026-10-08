import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { RunList, type AutomationRunSummary } from './run-list';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

vi.mock('@tanstack/react-router', () => ({
  Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params, children, ...rest },
    ref,
  ) {
    const path = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to ?? '',
    );
    return (
      <a ref={ref} href={path} {...rest}>
        {children}
      </a>
    );
  }),
}));

const directory = vi.hoisted(() => ({
  members: [
    { userId: 'user-me', displayName: 'Zoe A.', email: 'zoe@example.test' },
    {
      userId: 'user-dana',
      displayName: 'Dana K.',
      email: 'dana@example.test',
    },
    { userId: 'user-mail', displayName: null, email: 'mail@example.test' },
  ] as
    | { userId: string; displayName: string | null; email: string | null }[]
    | undefined,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: directory.members }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

function run(overrides: Partial<AutomationRunSummary>): AutomationRunSummary {
  return {
    id: 'run-1',
    name: 'ops/greet',
    version: 2,
    status: 'success',
    mode: 'mock',
    startedBy: 'user:user-me',
    startedAt: 1_789_363_168_936,
    finishedAt: 1_789_363_170_729,
    ...overrides,
  };
}

function renderRuns(runs: AutomationRunSummary[]) {
  return render(
    <RunList
      organizationId="org-1"
      automationSlug="ops/greet"
      runs={runs}
      headingId="runs-heading"
    />,
  );
}

/**
 * A run row names its starter and its reason in WORDS: the record carries
 * the door that started it (`user:<id>`, `trigger:<id>`) and the park it
 * waits on (`approval:<uuid>`, `repeat:<node>`), and both used to print
 * verbatim (2026-09-26 evaluation, D-01 and D-08).
 */
describe('RunList starters', () => {
  it('names the reader, a member, and an API key holder — never the raw door', () => {
    renderRuns([
      run({ id: 'r-me', startedBy: 'user:user-me' }),
      run({ id: 'r-dana', startedBy: 'user:user-dana' }),
      run({ id: 'r-api', startedBy: 'api-key:user-dana' }),
      run({ id: 'r-mail', startedBy: 'user:user-mail' }),
      run({ id: 'r-bare', startedBy: 'user-dana' }),
    ]);
    expect(screen.getByText('Started by you')).toBeVisible();
    // The prefixed and the bare (legacy) user id both name Dana.
    expect(screen.getAllByText('Started by Dana K.')).toHaveLength(2);
    expect(screen.getByText('Started by Dana K. (API)')).toBeVisible();
    expect(screen.getByText('Started by mail@example.test')).toBeVisible();
    expect(screen.queryByText(/user:/)).toBeNull();
    expect(screen.queryByText(/user-dana/)).toBeNull();
  });

  it('reads a member the directory no longer lists as a former member', () => {
    renderRuns([run({ startedBy: 'user:user-gone' })]);
    expect(screen.getByText('Started by a former member')).toBeVisible();
    expect(screen.queryByText(/user-gone/)).toBeNull();
  });

  it('never calls a person a former member before the list has loaded', () => {
    const members = directory.members;
    directory.members = undefined;
    try {
      renderRuns([
        run({ id: 'r-dana', startedBy: 'user:user-dana' }),
        run({ id: 'r-me', startedBy: 'user:user-me' }),
        run({ id: 'r-s', startedBy: 'trigger:t-1', startedVia: 'schedule' }),
      ]);
    } finally {
      directory.members = members;
    }
    // The reader and a trigger need no directory; a member does — until it
    // has answered, the neutral wording, never a verdict.
    expect(screen.getByText('Started by you')).toBeVisible();
    expect(screen.getByText('Started by the schedule')).toBeVisible();
    expect(screen.getByText('Starter not recorded')).toBeVisible();
    expect(screen.queryByText(/Started by Dana|former member/)).toBeNull();
    expect(screen.queryByText(/user-dana/)).toBeNull();
  });

  it('tells a scheduled run from a webhook delivery from an event', () => {
    renderRuns([
      run({ id: 'r-s', startedBy: 'trigger:t-1', startedVia: 'schedule' }),
      run({ id: 'r-w', startedBy: 'trigger:t-1', startedVia: 'webhook' }),
      run({ id: 'r-e', startedBy: 'trigger:t-1', startedVia: 'event' }),
      run({ id: 'r-t', startedBy: 'trigger:t-1' }),
    ]);
    expect(screen.getByText('Started by the schedule')).toBeVisible();
    expect(screen.getByText('Started by a webhook')).toBeVisible();
    expect(screen.getByText('Started by a platform event')).toBeVisible();
    expect(screen.getByText('Started by a trigger')).toBeVisible();
    expect(screen.queryByText(/trigger:t-1/)).toBeNull();
  });

  it('reads an unusable starter as not recorded', () => {
    renderRuns([run({ startedBy: '' })]);
    expect(screen.getByText('Starter not recorded')).toBeVisible();
  });
});

describe('RunList reasons', () => {
  it('says what a waiting run is parked on, in words', () => {
    renderRuns([
      run({
        id: 'r-a',
        status: 'waiting',
        waitingFor: 'approval',
        detail: 'approval:0ae97156-e148-4250-9a6f-dfe95893e9ac',
      }),
      run({
        id: 'r-r',
        status: 'waiting',
        waitingFor: 'repeat',
        detail: 'repeat:tick',
      }),
      run({
        id: 'r-g',
        status: 'waiting',
        waitingFor: 'agent',
        detail: 'agent:review',
      }),
      run({
        id: 'r-q',
        status: 'waiting',
        waitingFor: 'ask',
        detail: 'agent:review',
      }),
    ]);
    expect(screen.getByText('Waiting for approval')).toBeVisible();
    expect(screen.getByText('Polling — step tick')).toBeVisible();
    expect(screen.getByText('Agent working')).toBeVisible();
    expect(screen.getByText('Waiting for your answer')).toBeVisible();
    expect(screen.queryByText(/approval:/)).toBeNull();
    expect(screen.queryByText(/repeat:/)).toBeNull();
    expect(screen.queryByText(/agent:/)).toBeNull();
  });

  it('keeps the failure sentence of a failed run', () => {
    renderRuns([
      run({
        status: 'failed',
        detail: 'send: no usable credential for imap-smtp',
      }),
    ]);
    expect(
      screen.getByText('send: no usable credential for imap-smtp'),
    ).toBeVisible();
    expect(screen.queryByText('Started by you')).toBeNull();
  });

  it('names only the starter on a stopped run whose park is history', () => {
    renderRuns([
      run({
        status: 'cancelled',
        detail: 'repeat:tick',
        waitingFor: undefined,
      }),
    ]);
    expect(screen.getByText('Started by you')).toBeVisible();
    expect(screen.queryByText(/repeat/)).toBeNull();
  });
});

describe('RunList interruptions', () => {
  it('marks a running run whose server stopped as interrupted', () => {
    renderRuns([
      run({ id: 'r-stalled', status: 'running', stalled: true }),
      run({ id: 'r-live', status: 'running' }),
    ]);
    expect(screen.getByText('Interrupted — resuming')).toBeVisible();
    expect(screen.getByText('Running')).toBeVisible();
  });

  it('says which step may already have run when a write waits for a person', () => {
    renderRuns([
      run({
        status: 'waiting',
        waitingFor: 'in_doubt',
        detail: 'in_doubt:send_invoice',
      }),
    ]);
    expect(
      screen.getByText('Needs you — step send_invoice may already have run'),
    ).toBeVisible();
    expect(screen.queryByText(/in_doubt:/)).toBeNull();
  });
});
