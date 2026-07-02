import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { ThreadFileItem } from '../types';
import { WorkspaceFileTabs, WorkspaceOutputDock } from './workspace-file-tabs';

function file(path: string, source: ThreadFileItem['source']): ThreadFileItem {
  return {
    path,
    source,
    size: 1024,
    contentType: 'text/plain',
    updatedAt: 0,
  };
}

const FILES: ThreadFileItem[] = [
  file('/user/workspace/report.md', 'agent_write'),
  file('/user/workspace/plan.md', 'agent_write'),
  file('/user/workspace/input.pdf', 'user_upload'),
  file('/user/workspace/output/chart.png', 'run_output'),
];

describe('WorkspaceFileTabs', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <>
          <WorkspaceFileTabs
            files={FILES}
            activePath="/user/workspace/report.md"
            onSelect={vi.fn()}
            viewerId="viewer"
          />
          {/* The real viewer the tabs control — `aria-controls` must resolve. */}
          <div id="viewer" role="tabpanel" />
        </>,
      );
      await checkAccessibility(container);
    });
  });

  it('renders agent_write + user_upload files as horizontal tabs, in that order', () => {
    render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/report.md"
        onSelect={vi.fn()}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    // report.md, plan.md (agent_write) then input.pdf (user_upload) — NOT chart.png.
    expect(tabs.map((t) => t.getAttribute('data-path'))).toEqual([
      '/user/workspace/report.md',
      '/user/workspace/plan.md',
      '/user/workspace/input.pdf',
    ]);
  });

  it('excludes run_output files from the top tab strip', () => {
    render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/report.md"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole('tab', { name: /chart\.png/ })).toBeNull();
  });

  it('renders nothing when there are no tab files', () => {
    const { container } = render(
      <WorkspaceFileTabs
        files={[file('/user/workspace/output/chart.png', 'run_output')]}
        activePath={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('announces the source group in each tab name (icon-only cue)', () => {
    render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/report.md"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('tab', { name: 'report.md — AI files' }),
    ).toBeDefined();
    expect(
      screen.getByRole('tab', { name: 'input.pdf — Uploaded' }),
    ).toBeDefined();
  });

  it('marks the active tab aria-selected', () => {
    render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/plan.md"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('tab', { name: 'plan.md — AI files' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('selects a file when its tab is clicked', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/report.md"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'input.pdf — Uploaded' }));
    expect(onSelect).toHaveBeenCalledWith('/user/workspace/input.pdf');
  });

  it('renders the active-file meta slot (no duplicate filename row)', () => {
    render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/plan.md"
        onSelect={vi.fn()}
        meta="2 KB"
      />,
    );
    // The filename appears once — as a tab, not also in a separate sub-header.
    expect(screen.getAllByText('plan.md')).toHaveLength(1);
    expect(screen.getByText('2 KB')).toBeDefined();
  });

  it('moves selection with the arrow keys (wrapping)', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <WorkspaceFileTabs
        files={FILES}
        activePath="/user/workspace/report.md"
        onSelect={onSelect}
      />,
    );
    const active = screen.getByRole('tab', { name: 'report.md — AI files' });
    active.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('/user/workspace/plan.md');
    await user.keyboard('{ArrowLeft}');
    // Left from the first tab wraps to the last tab file (input.pdf).
    expect(onSelect).toHaveBeenLastCalledWith('/user/workspace/input.pdf');
  });
});

describe('WorkspaceOutputDock', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <>
          <WorkspaceOutputDock
            files={FILES}
            activePath={null}
            onSelect={vi.fn()}
            viewerId="viewer"
          />
          {/* The real viewer the chips control — `aria-controls` must resolve. */}
          <div id="viewer" role="tabpanel" />
        </>,
      );
      await checkAccessibility(container);
    });
  });

  it('lists only run_output files under a Code output group', () => {
    render(
      <WorkspaceOutputDock
        files={FILES}
        activePath={null}
        onSelect={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: 'Code output' });
    expect(group).toBeDefined();
    expect(screen.getByRole('button', { name: 'chart.png' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'report.md' })).toBeNull();
  });

  it('renders nothing when there are no run_output files', () => {
    const { container } = render(
      <WorkspaceOutputDock
        files={[file('/user/workspace/report.md', 'agent_write')]}
        activePath={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('selects the output file when its chip is clicked', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <WorkspaceOutputDock
        files={FILES}
        activePath={null}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'chart.png' }));
    expect(onSelect).toHaveBeenCalledWith('/user/workspace/output/chart.png');
  });

  describe('overflow expand toggle', () => {
    const MANY = Array.from({ length: 9 }, (_, i) =>
      file(`/user/output/slide-${i + 1}.jpg`, 'run_output'),
    );

    /** jsdom has no layout: scrollWidth/clientWidth are always 0, so the row
     *  never measures as overflowing. Force the geometry to simulate a strip
     *  wider than its container (the user-reported 9-slide case). */
    function forceOverflow() {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get() {
          return 800;
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() {
          return 400;
        },
      });
      return () => {
        // oxlint-disable-next-line typescript/no-dynamic-delete
        delete (HTMLElement.prototype as { scrollWidth?: unknown }).scrollWidth;
        // oxlint-disable-next-line typescript/no-dynamic-delete
        delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
      };
    }

    it('hides the toggle when the chips fit (no overflow)', () => {
      render(
        <WorkspaceOutputDock
          files={FILES}
          activePath={null}
          onSelect={vi.fn()}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'Show all files' }),
      ).toBeNull();
    });

    it('shows the toggle when the row overflows and expands to reveal all files', async () => {
      const restore = forceOverflow();
      try {
        const { user } = render(
          <WorkspaceOutputDock
            files={MANY}
            activePath={null}
            onSelect={vi.fn()}
          />,
        );
        const toggle = screen.getByRole('button', { name: 'Show all files' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        await user.click(toggle);
        const collapse = screen.getByRole('button', {
          name: 'Show fewer files',
        });
        expect(collapse.getAttribute('aria-expanded')).toBe('true');
        // Every chip stays reachable in the expanded wrap.
        for (const f of MANY) {
          const name = f.path.split('/').at(-1) ?? '';
          expect(screen.getByRole('button', { name })).toBeDefined();
        }

        await user.click(collapse);
        expect(
          screen
            .getByRole('button', { name: 'Show all files' })
            .getAttribute('aria-expanded'),
        ).toBe('false');
      } finally {
        restore();
      }
    });

    it('passes axe audit while expanded', async () => {
      const restore = forceOverflow();
      try {
        const { user, container } = render(
          <WorkspaceOutputDock
            files={MANY}
            activePath={null}
            onSelect={vi.fn()}
          />,
        );
        await user.click(
          screen.getByRole('button', { name: 'Show all files' }),
        );
        await checkAccessibility(container);
      } finally {
        restore();
      }
    });
  });
});
