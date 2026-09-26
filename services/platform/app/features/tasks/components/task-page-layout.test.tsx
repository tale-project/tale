import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TaskPageLayout } from './task-page-layout';

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock('@tale/ui/use-is-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}));
vi.mock('@/app/features/home/components/home-panel-toggle', () => ({
  HomePanelToggle: () => null,
}));
vi.mock('@/app/features/home/components/home-back-button', () => ({
  HomeBackButton: () => null,
}));

beforeEach(() => {
  viewport.mobile = false;
  localStorage.clear();
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

  it('connects the mobile details opener to its visible sheet and restores focus', async () => {
    viewport.mobile = true;
    const { user } = taskPage();
    const opener = screen.getByRole('button', { name: 'Show details' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    const controlled = document.getElementById(
      opener.getAttribute('aria-controls') ?? '',
    );
    expect(controlled).not.toBeNull();
    expect(dialog.contains(controlled)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
