import '@testing-library/jest-dom/vitest';
import { Button } from '@tale/ui/button';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import { MobileFloatingActions } from './mobile-floating-actions';

import '@tale/ui/globals.css';

// Real-Chromium coverage for the dock's frame: the space between its border
// and the actions it holds is one inset on every side, including once the
// actions wrap onto several rows — the case where a `w-fit` flex box would
// otherwise stretch to its cap and pad the rows' leading edge.
afterEach(cleanup);

/** The `p-2` inset every side of the dock keeps. */
const INSET = 8;

/** The run and save verbs an automation's editor docks on a phone, nested
 * the way a tab strip's actions slot hands them over. */
function EditorVerbs({ withDeploy = true }: { withDeploy?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="secondary">
          v12
        </Button>
        {withDeploy && (
          <Button size="sm" variant="secondary">
            Deploy this version
          </Button>
        )}
        <Button size="sm" variant="secondary">
          Test run
        </Button>
        <Button size="sm" variant="secondary">
          Run live
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary">
            Discard
          </Button>
          <Button size="sm">Save</Button>
        </div>
      </div>
    </div>
  );
}

function dockOf(control: HTMLElement) {
  const dock = control.closest('.fixed')?.firstElementChild;
  if (!(dock instanceof HTMLElement)) {
    throw new Error('The control is not inside a dock');
  }
  return dock;
}

/** How far the dock's border sits from the actions it holds, per side. */
function insetsOf(dock: HTMLElement) {
  const frame = dock.getBoundingClientRect();
  const style = getComputedStyle(dock);
  const boxes = Array.from(dock.querySelectorAll('button'), (button) =>
    button.getBoundingClientRect(),
  );
  return {
    top:
      Math.min(...boxes.map((box) => box.top)) -
      frame.top -
      parseFloat(style.borderTopWidth),
    right:
      frame.right -
      parseFloat(style.borderRightWidth) -
      Math.max(...boxes.map((box) => box.right)),
    bottom:
      frame.bottom -
      parseFloat(style.borderBottomWidth) -
      Math.max(...boxes.map((box) => box.bottom)),
    left:
      Math.min(...boxes.map((box) => box.left)) -
      frame.left -
      parseFloat(style.borderLeftWidth),
  };
}

function rowCountOf(dock: HTMLElement) {
  const tops = Array.from(dock.querySelectorAll('button'), (button) =>
    Math.round(button.getBoundingClientRect().top),
  );
  return new Set(tops).size;
}

async function expectEvenInsets(dock: HTMLElement) {
  await waitFor(() => {
    const insets = insetsOf(dock);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(Math.abs(insets[side] - INSET), side).toBeLessThan(1);
    }
  });
}

async function renderedDock(name: string) {
  const dock = dockOf(await screen.findByRole('button', { name }));
  await waitFor(() => {
    expect(dock.parentElement).not.toHaveClass('hidden');
  });
  return dock;
}

describe('MobileFloatingActions frame in Chromium', () => {
  it('keeps one inset on every side of a single row', async () => {
    await page.viewport(390, 844);
    render(
      <MobileFloatingActions>
        <Button size="sm" variant="secondary">
          Discard
        </Button>
        <Button size="sm">Save</Button>
      </MobileFloatingActions>,
    );

    const dock = await renderedDock('Save');
    expect(rowCountOf(dock)).toBe(1);
    await expectEvenInsets(dock);
  });

  it('hugs the widest row once the actions wrap, and follows them as they change', async () => {
    await page.viewport(390, 844);
    const verbs = (withDeploy: boolean) => (
      <MobileFloatingActions>
        <EditorVerbs withDeploy={withDeploy} />
      </MobileFloatingActions>
    );
    const { rerender } = render(verbs(true));

    const dock = await renderedDock('Save');
    expect(rowCountOf(dock)).toBeGreaterThan(1);
    await expectEvenInsets(dock);

    // Without the deploy verb the rest fits on one row: the dock lets go of
    // the hugged width instead of wrapping actions that no longer need it.
    rerender(verbs(false));
    await waitFor(() => {
      expect(rowCountOf(dock)).toBe(1);
    });
    await expectEvenInsets(dock);

    rerender(verbs(true));
    await waitFor(() => {
      expect(rowCountOf(dock)).toBeGreaterThan(1);
    });
    await expectEvenInsets(dock);

    await page.viewport(430, 932);
    await expectEvenInsets(dock);
  });
});
