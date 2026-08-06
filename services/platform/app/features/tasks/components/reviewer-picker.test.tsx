// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { AssignableActor } from '../hooks/use-actor-directory';
import { ReviewerPicker } from './reviewer-picker';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

const members: AssignableActor[] = [
  {
    type: 'user',
    id: 'user-1',
    name: 'Alex',
    email: 'alex@example.com',
    role: 'editor',
  },
  {
    type: 'user',
    id: 'user-2',
    name: 'Bea',
    email: 'bea@example.com',
    role: 'owner',
  },
  {
    type: 'user',
    id: 'user-3',
    name: 'Cara',
    email: 'cara@example.com',
    role: 'member',
  },
  { type: 'user', id: 'user-4', name: 'Dan', email: 'dan@example.com' },
];

vi.mock('../hooks/use-actor-directory', () => ({
  useAssignableActors: () => ({
    assignableMembers: members,
    currentUserId: 'user-2',
    resolveActor: (_type: string, id: string) => ({
      type: 'user',
      id,
      name: members.find((m) => m.id === id)?.name ?? id,
      isAgent: false,
    }),
  }),
}));

describe('ReviewerPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists only members holding an editor-level role, current user first', async () => {
    const { user } = render(
      <ReviewerPicker organizationId="org-1" onChange={vi.fn()} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );

    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    // Read-only member and role-less entries are not designation candidates.
    expect(screen.queryByText('Cara')).not.toBeInTheDocument();
    expect(screen.queryByText('Dan')).not.toBeInTheDocument();
    // The eligibility hint explains the shortened list.
    expect(screen.getByText('tasks.reviewer.editorsOnly')).toBeInTheDocument();
  });

  it('designates on select and clears via the footer action', async () => {
    const onChange = vi.fn();
    const first = render(
      <ReviewerPicker organizationId="org-1" onChange={onChange} />,
    );
    await first.user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    await first.user.click(screen.getByText('Alex'));
    expect(onChange).toHaveBeenCalledWith('user-1');
    first.unmount();

    onChange.mockClear();
    const second = render(
      <ReviewerPicker
        organizationId="org-1"
        reviewerUserId="user-1"
        onChange={onChange}
      />,
    );
    await second.user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    await second.user.click(screen.getByText('tasks.reviewer.clear'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps the clear action out of an undesignated picker', async () => {
    const { user } = render(
      <ReviewerPicker organizationId="org-1" onChange={vi.fn()} />,
    );
    await user.click(
      screen.getByRole('button', { name: 'tasks.fields.reviewer' }),
    );
    expect(screen.queryByText('tasks.reviewer.clear')).not.toBeInTheDocument();
  });

  it('renders a bare avatar without a menu when disabled', () => {
    render(
      <ReviewerPicker
        organizationId="org-1"
        reviewerUserId="user-1"
        onChange={vi.fn()}
        disabled
        afterTrigger={<span>Alex</span>}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'tasks.fields.reviewer' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });
});
