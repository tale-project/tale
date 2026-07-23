// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { ChatThreadSummary } from '../types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params: Record<string, string>;
    className?: string;
    'aria-current'?: 'page';
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { ThreadList } from './thread-list';

const THREADS: ChatThreadSummary[] = [
  {
    id: 't1',
    title: 'Quarterly report',
    kind: 'direct',
    archived: false,
    updatedAt: 2,
    generating: false,
  },
  {
    id: 't2',
    title: 'Refactor the importer',
    kind: 'sandbox',
    archived: false,
    updatedAt: 1,
    generating: true,
  },
];

describe('ThreadList', () => {
  it('lists every thread', () => {
    render(<ThreadList organizationId="org-1" threads={THREADS} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Quarterly report')).toBeInTheDocument();
  });

  it('marks the sandbox thread and the one that is generating', () => {
    render(<ThreadList organizationId="org-1" threads={THREADS} />);

    expect(screen.getByLabelText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText('Generating response')).toBeInTheDocument();
  });

  it('marks the open thread as the current page', () => {
    render(
      <ThreadList
        organizationId="org-1"
        threads={THREADS}
        activeThreadId="t2"
      />,
    );

    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent(
      'Refactor the importer',
    );
  });

  it('names an untitled thread rather than showing a blank row', () => {
    render(
      <ThreadList
        organizationId="org-1"
        threads={[{ ...THREADS[0], title: undefined }]}
      />,
    );

    expect(screen.getByText('Untitled chat')).toBeInTheDocument();
  });

  it('says the backend is not connected instead of claiming there are no chats', () => {
    render(
      <ThreadList organizationId="org-1" threads={[]} available={false} />,
    );

    expect(screen.getByText("Chat isn't connected yet")).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).toBeNull();
    expect(screen.getByRole('button', { name: /new chat/i })).toBeDisabled();
  });

  it('shows the empty state once the backend answers with no threads', () => {
    render(<ThreadList organizationId="org-1" threads={[]} />);

    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <ThreadList organizationId="org-1" threads={THREADS} />,
    );
    await waitFor(() => checkAccessibility(container));
  });
});
