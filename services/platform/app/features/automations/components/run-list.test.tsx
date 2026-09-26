import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { RunList, type AutomationRunSummary } from './run-list';

vi.mock('@tanstack/react-router', () => ({
  Link: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
    function Link({ children, ...rest }, ref) {
      return (
        <a ref={ref} href="#run" className={rest.className}>
          {children}
        </a>
      );
    },
  ),
}));

const mockMembers = vi.hoisted(() => ({
  members: [
    { userId: 'u-ada', displayName: 'Ada Lovelace', email: 'ada@example.com' },
    { userId: 'u-mail', displayName: null, email: 'grace@example.com' },
  ] as
    | { userId: string; displayName: string | null; email: string | null }[]
    | undefined,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: mockMembers.members, isLoading: false }),
}));

function run(id: string, startedBy: string): AutomationRunSummary {
  return {
    id,
    name: 'triage',
    version: 1,
    status: 'success',
    mode: 'mock',
    startedBy,
    startedAt: Date.UTC(2026, 8, 26, 12),
  };
}

describe('RunList', () => {
  it('names who started each run instead of printing the stored door', () => {
    render(
      <RunList
        organizationId="org-1"
        automationSlug="triage"
        headingId="runs"
        runs={[
          run('r1', 'user:u-ada'),
          run('r2', 'api-key:u-ada'),
          run('r3', 'trigger:t-1'),
          run('r4', 'user:u-mail'),
          run('r5', 'user:u-gone'),
        ]}
      />,
    );

    expect(screen.getByText('Started by Ada Lovelace')).toBeInTheDocument();
    expect(
      screen.getByText('Started by Ada Lovelace via an API key'),
    ).toBeInTheDocument();
    expect(screen.getByText('Started by a trigger')).toBeInTheDocument();
    expect(
      screen.getByText('Started by grace@example.com'),
    ).toBeInTheDocument();
    expect(screen.getByText('Started by a former member')).toBeInTheDocument();
    expect(screen.queryByText(/user:|api-key:|trigger:/)).toBeNull();
  });

  it('says nothing about the starter until the member list has loaded', () => {
    mockMembers.members = undefined;
    render(
      <RunList
        organizationId="org-1"
        automationSlug="triage"
        headingId="runs"
        runs={[run('r1', 'user:u-ada')]}
      />,
    );
    expect(screen.queryByText(/Started by/)).toBeNull();
    expect(screen.queryByText(/u-ada/)).toBeNull();
  });
});
