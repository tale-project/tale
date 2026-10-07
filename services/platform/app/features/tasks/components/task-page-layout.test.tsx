import { Button } from '@tale/ui/button';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TaskPageLayout } from './task-page-layout';

const viewport = vi.hoisted(() => ({ mobile: false, canDock: true }));
vi.mock('@tale/ui/use-is-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}));
vi.mock('@tale/ui/use-media-query', () => ({
  useMediaQuery: () => viewport.canDock,
}));

beforeEach(() => {
  viewport.mobile = false;
  viewport.canDock = true;
  localStorage.clear();
});

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

function taskPage() {
  return render(
    <TaskPageLayout
      organizationId="org-1"
      leading={<span aria-hidden>T</span>}
      title={<h1>Investigate the imported issue</h1>}
      brief={<h3>GitHub issue</h3>}
      conversation={<p>The agent finished its investigation.</p>}
      panel={<button>Change assignee</button>}
    />,
  );
}

describe('TaskPageLayout accessibility', () => {
  it('groups brief headings beneath the task page heading', async () => {
    const { container } = taskPage();
    await checkAccessibility(container, { runOnly: ['heading-order'] });
  });

  it.each([
    { layout: 'phone', mobile: true },
    { layout: 'tablet', mobile: false },
  ])(
    'connects the $layout details opener to its visible sheet and restores focus',
    async ({ mobile }) => {
      viewport.mobile = mobile;
      viewport.canDock = false;
      const { user } = taskPage();
      // The hidden desktop copy used to mount the entire details tree on
      // phones, and opening the sheet mounted it a second time.
      expect(screen.queryByText('Change assignee')).toBeNull();
      const opener = screen.getByRole('button', { name: 'Show details' });
      expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
      expect(opener).toHaveAttribute('aria-expanded', 'false');
      expect(opener).not.toHaveAttribute('aria-controls');
      await user.click(opener);
      const dialog = screen.getByRole('dialog', { name: 'Details' });
      expect(screen.getAllByText('Change assignee')).toHaveLength(1);
      const controlled = document.getElementById(
        opener.getAttribute('aria-controls') ?? '',
      );
      expect(controlled).not.toBeNull();
      expect(dialog.contains(controlled)).toBe(true);
      expect(opener).toHaveAccessibleName('Hide details');
      expect(opener).toHaveAttribute('aria-expanded', 'true');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(opener).toHaveAccessibleName('Show details');
      expect(opener).toHaveFocus();
    },
  );
});
