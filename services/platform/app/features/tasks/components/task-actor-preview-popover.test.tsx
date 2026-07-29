// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskActorName } from './task-actor-preview-popover';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => `tasks.${key}`,
  }),
}));

describe('TaskActorName', () => {
  it('renders a plain name when no preview is available', () => {
    render(<TaskActorName preview={null} name="Israel" />);
    expect(screen.getByText('Israel')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a preview trigger for agent actors', () => {
    render(
      <TaskActorName
        name="Writer"
        preview={{
          kind: 'agent',
          name: 'Writer',
          description: 'Drafts copy.',
          viewTo: '/dashboard/$id',
          viewParams: { id: 'org_1' },
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Writer' })).toBeInTheDocument();
  });
});
