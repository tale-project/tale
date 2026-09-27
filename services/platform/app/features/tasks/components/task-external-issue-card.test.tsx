import { expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskExternalIssueCard } from './task-external-issue-card';

const snapshot = {
  id: 'immutable-123',
  title: 'Source title after a rename',
  description: 'Source details',
  url: 'https://github.com/new-owner/new-repo/issues/7',
  state: 'closed',
  syncedAt: 1790450000000,
};

it('smart links the current canonical issue and keeps source resolution separate from Tale status', async () => {
  const { user } = render(
    <TaskExternalIssueCard
      externalSystem="github"
      externalId="old-owner/old-repo#7"
      externalUrl="https://github.com/old-owner/old-repo/issues/7"
      externalIssue={snapshot}
    />,
  );
  const link = screen.getByRole('link', { name: snapshot.title });
  expect(link).toHaveAttribute('href', snapshot.url);
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Closed at source')).toBeVisible();
  expect(
    screen.getByText(
      'Source status is separate from this task. Review and complete the task in Tale.',
    ),
  ).toBeVisible();
  await user.click(screen.getByText('Source description'));
  expect(screen.getByText('Source details')).toBeVisible();
});

it('shows GlitchTip resolution and retains details when a source becomes unavailable', () => {
  render(
    <TaskExternalIssueCard
      externalSystem="glitchtip"
      externalIssue={{
        ...snapshot,
        url: 'https://errors.example.test/organizations/example/issues/123',
        state: 'resolved',
        unavailable: true,
      }}
    />,
  );
  expect(screen.getByRole('region', { name: 'GlitchTip issue' })).toBeVisible();
  expect(screen.getByText('Resolved at source')).toBeVisible();
  expect(
    screen.getByText(/no longer available to this connection/),
  ).toBeVisible();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    'https://errors.example.test/organizations/example/issues/123',
  );
});

it('links historical tasks without a snapshot and refuses unsafe URLs', () => {
  const { rerender } = render(
    <TaskExternalIssueCard
      externalSystem="github"
      externalId="example/app#1"
      externalUrl="https://github.com/example/app/issues/1"
    />,
  );
  expect(screen.getByRole('link', { name: 'example/app#1' })).toBeVisible();
  rerender(
    <TaskExternalIssueCard
      externalSystem="github"
      externalUrl="javascript:alert(1)"
      externalIssue={{ ...snapshot, url: 'javascript:alert(1)' }}
    />,
  );
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
