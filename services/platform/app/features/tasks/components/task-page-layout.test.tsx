import { Button } from '@tale/ui/button';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskPageLayout } from './task-page-layout';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: string;
    params?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

function renderPage(loading: boolean) {
  return render(
    <TaskPageLayout
      loading={loading}
      organizationId="org-1"
      leading={<span />}
      title={<span>Review the launch checklist</span>}
      actions={<Button>Copy link</Button>}
      brief={<p>What the task is</p>}
      conversation={null}
      panel={<p>Details</p>}
    />,
  );
}

describe('TaskPageLayout', () => {
  it('keeps the way back and the page verbs live while the task loads', () => {
    renderPage(true);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    for (const control of [
      screen.getByRole('link', { name: /back/i }),
      screen.getByRole('button', { name: 'Copy link' }),
      screen.getByRole('button', { name: /details/i }),
    ]) {
      expect(control.closest('[inert]')).toBeNull();
      expect(control.closest('[aria-hidden="true"]')).toBeNull();
    }
  });

  it('is an ordinary page once the task is there', () => {
    renderPage(false);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('What the task is')).toBeInTheDocument();
  });
});
