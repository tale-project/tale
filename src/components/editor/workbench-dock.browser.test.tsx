import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { createRef, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import { CLAIMS_ESCAPE_ATTRIBUTE } from '../overlays/claims-escape';
import {
  WorkbenchDock,
  WorkbenchSheet,
  type WorkbenchDockHandle,
  type WorkbenchDockPanel,
} from './workbench-dock';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const PROBLEMS: WorkbenchDockPanel = {
  id: 'problems',
  label: 'Problems',
  badge: '2 errors',
  actions: <button type="button">All</button>,
  content: (
    <ul aria-label="Problems">
      <li>Reads a node that does not exist</li>
    </ul>
  ),
};

const TESTS: WorkbenchDockPanel = {
  id: 'tests',
  label: 'Tests',
  badge: '2 passed, 1 failed',
  actions: <button type="button">Run all</button>,
  content: (
    <ul aria-label="Test results">
      <li>Big order gets a discount</li>
    </ul>
  ),
};

/** A host as the editor is one: a button opens the dock, closing it puts
 * focus back on that button. */
function Host({
  panels,
  onClose,
}: {
  panels: readonly WorkbenchDockPanel[];
  onClose?: () => void;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(panels[0]?.id ?? '');
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-expanded={open}
        aria-controls={open ? 'dock' : undefined}
        onClick={() => setOpen((previous) => !previous)}
      >
        Open the dock
      </button>
      {open && (
        <WorkbenchDock
          id="dock"
          panels={panels}
          activeId={active}
          onActiveChange={setActive}
          expanded={expanded}
          onExpandedChange={setExpanded}
          closeLabel="Hide the dock"
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
            onClose?.();
          }}
        />
      )}
    </>
  );
}

/** Opens the dock and waits for it to rise into place: mid-fade it is
 * not yet visible. */
async function openDock() {
  await userEvent.click(screen.getByRole('button', { name: 'Open the dock' }));
  const dock = screen.getByRole('region');
  await Promise.all(
    dock.getAnimations().map((animation) => animation.finished),
  );
}

describe('WorkbenchDock — one panel', () => {
  it('is a region named by its title, with the counts, controls and Close', async () => {
    render(<Host panels={[PROBLEMS]} />);
    await openDock();
    const dock = screen.getByRole('region', { name: 'Problems' });
    expect(dock).toHaveAttribute('id', 'dock');
    expect(
      within(dock).getByRole('heading', { name: 'Problems' }),
    ).toBeVisible();
    expect(within(dock).getByText('2 errors')).toBeVisible();
    expect(within(dock).getByRole('button', { name: 'All' })).toBeVisible();
    expect(within(dock).queryByRole('tablist')).toBeNull();
    await userEvent.click(
      within(dock).getByRole('button', { name: 'Hide the dock' }),
    );
    expect(screen.queryByRole('region', { name: 'Problems' })).toBeNull();
  });

  it('closes on Escape from inside and returns focus to the opener', async () => {
    const onClose = vi.fn();
    render(<Host panels={[PROBLEMS]} onClose={onClose} />);
    await openDock();
    const dock = screen.getByRole('region', { name: 'Problems' });
    within(dock).getByRole('button', { name: 'All' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the dock' })).toHaveFocus();
  });

  it('stays open for an Escape a widget inside has claimed', async () => {
    const onClose = vi.fn();
    render(
      <WorkbenchDock
        panels={[
          {
            ...PROBLEMS,
            content: (
              <div {...{ [CLAIMS_ESCAPE_ATTRIBUTE]: '' }}>
                <input aria-label="Code" />
              </div>
            ),
          },
        ]}
        activeId="problems"
        closeLabel="Hide the dock"
        onClose={onClose}
      />,
    );
    screen.getByRole('textbox', { name: 'Code' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('switches between its two heights at once, Expand and Collapse named', async () => {
    render(<Host panels={[PROBLEMS]} />);
    await openDock();
    const dock = screen.getByRole('region', { name: 'Problems' });
    const body = () =>
      dock.querySelector<HTMLElement>('ul')?.parentElement ?? dock;
    expect(getComputedStyle(body()).maxHeight).toBe('224px');
    expect(getComputedStyle(body()).transitionProperty).not.toMatch(/height/);
    await userEvent.click(
      within(dock).getByRole('button', { name: 'Expand panel' }),
    );
    expect(dock).toHaveAttribute('data-expanded', 'true');
    expect(getComputedStyle(body()).maxHeight).not.toBe('224px');
    await userEvent.click(
      within(dock).getByRole('button', { name: 'Collapse panel' }),
    );
    expect(getComputedStyle(body()).maxHeight).toBe('224px');
  });

  it('offers no Expand when the host keeps one height', () => {
    render(
      <WorkbenchDock
        panels={[PROBLEMS]}
        activeId="problems"
        closeLabel="Hide the dock"
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Expand panel' })).toBeNull();
  });
});

describe('WorkbenchDock — tabs', () => {
  it('shows two panels as tabs, the active one’s controls in the header', async () => {
    render(<Host panels={[PROBLEMS, TESTS]} />);
    await openDock();
    const dock = screen.getByRole('region', { name: 'Problems' });
    const tabs = within(dock).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Problems2 errors',
      'Tests2 passed, 1 failed',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(dock).getByRole('button', { name: 'All' })).toBeVisible();
    expect(within(dock).queryByRole('button', { name: 'Run all' })).toBeNull();

    await userEvent.click(tabs[1]!);
    expect(screen.getByRole('region', { name: 'Tests' })).toBe(dock);
    expect(within(dock).getByRole('button', { name: 'Run all' })).toBeVisible();
    expect(within(dock).getByRole('tabpanel')).toHaveTextContent(
      'Big order gets a discount',
    );
  });

  it('moves between tabs with the arrow keys and keeps the other panel mounted', async () => {
    render(<Host panels={[PROBLEMS, TESTS]} />);
    await openDock();
    const dock = screen.getByRole('region', { name: 'Problems' });
    const [problems, tests] = within(dock).getAllByRole('tab');
    problems!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tests).toHaveFocus();
    expect(tests).toHaveAttribute('aria-selected', 'true');
    // Hidden, not gone: it keeps its scroll and its state.
    const hidden = dock.querySelector('ul[aria-label="Problems"]');
    expect(hidden).not.toBeNull();
    expect(hidden).not.toBeVisible();
  });

  it('focuses the active tab through its handle', () => {
    const ref = createRef<WorkbenchDockHandle>();
    render(
      <WorkbenchDock
        ref={ref}
        panels={[PROBLEMS, TESTS]}
        activeId="tests"
        closeLabel="Hide the dock"
        onClose={() => {}}
      />,
    );
    ref.current?.focus();
    expect(screen.getByRole('tab', { name: /^Tests/ })).toHaveFocus();
  });
});

describe('WorkbenchDock — width and motion', () => {
  it('wraps its header at 375px without scrolling sideways', async () => {
    await page.viewport(375, 740);
    const { container } = render(
      <div className="w-[375px]">
        <WorkbenchDock
          panels={[PROBLEMS, TESTS]}
          activeId="problems"
          closeLabel="Hide the dock"
          onExpandedChange={() => {}}
          onClose={() => {}}
        />
      </div>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    const close = screen.getByRole('button', { name: 'Hide the dock' });
    expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(375);
  });

  it('rises into place, and appears at once under reduced motion', async () => {
    const { rerender } = render(
      <WorkbenchDock
        key="a"
        panels={[PROBLEMS]}
        activeId="problems"
        closeLabel="Hide the dock"
        onClose={() => {}}
      />,
    );
    const dock = () => screen.getByRole('region', { name: 'Problems' });
    expect(getComputedStyle(dock()).animationName).not.toBe('none');
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    rerender(
      <WorkbenchDock
        key="b"
        panels={[PROBLEMS]}
        activeId="problems"
        closeLabel="Hide the dock"
        onClose={() => {}}
      />,
    );
    expect(getComputedStyle(dock()).animationName).toBe('none');
  });
});

describe.each(['light', 'dark'])('WorkbenchDock contrast (%s)', (theme) => {
  it('keeps its header and tabs readable', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className="bg-background text-foreground w-[40rem]">
        <WorkbenchDock
          panels={[PROBLEMS, TESTS]}
          activeId="tests"
          closeLabel="Hide the dock"
          onExpandedChange={() => {}}
          onClose={() => {}}
        />
        <WorkbenchDock
          panels={[PROBLEMS]}
          activeId="problems"
          closeLabel="Hide the dock"
          onClose={() => {}}
        />
      </div>,
    );
    // Let the dock rise into place: axe reads the colour at rest.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const result = await axe.run(container, {
      runOnly: [
        'color-contrast',
        'aria-allowed-attr',
        'aria-required-children',
        'aria-valid-attr-value',
        'button-name',
        'landmark-unique',
      ],
    });
    expect(result.violations).toEqual([]);
    expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
      true,
    );
  });
});

function intersects(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

// The sheet's chrome in real Chromium: its close is the dialog family's 32px
// corner button, and the title row keeps clear of it on a tablet's dialog
// and a phone's drawer.
describe.each([
  { device: 'tablet', width: 900 },
  { device: 'phone', width: 390 },
])('WorkbenchSheet chrome ($device)', ({ width }) => {
  it('keeps the title clear of the 32px close', async () => {
    await page.viewport(width, 844);
    render(
      <WorkbenchSheet
        open
        onOpenChange={() => {}}
        title="Problems"
        description="1 error"
        actions={<button type="button">All</button>}
        closeLabel="Hide problems"
      >
        <ul aria-label="Problems">
          <li>Reads a node that does not exist</li>
        </ul>
      </WorkbenchSheet>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Problems' });
    // Measured at rest: the dialog zooms in from 95 %.
    await Promise.all(
      sheet.getAnimations().map((animation) => animation.finished),
    );
    expect(sheet).toHaveAccessibleDescription('1 error');
    expect(within(sheet).getByRole('button', { name: 'All' })).toBeVisible();
    const close = within(sheet).getByRole('button', { name: 'Hide problems' });
    const closeBox = close.getBoundingClientRect();
    expect(closeBox.width).toBeCloseTo(32, 0);
    expect(closeBox.height).toBeCloseTo(32, 0);
    const title = within(sheet).getByText('Problems', { selector: 'h2' });
    const range = document.createRange();
    range.selectNodeContents(title);
    for (const line of Array.from(range.getClientRects())) {
      expect(intersects(line, closeBox)).toBe(false);
    }
  });
});
