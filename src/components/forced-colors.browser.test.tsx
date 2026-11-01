import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import { WorkbenchDock } from './editor/workbench-dock';
import { TestResultList } from './feedback/test-results';
import { SegmentedControl } from './forms/segmented-control';
import { Slider } from './forms/slider';
import { ToggleChipGroup } from './forms/toggle-chip-group';
import { TabNavigation } from './navigation/tab-navigation';
import { Tabs } from './navigation/tabs';
import { Button } from './primitives/button';

import '../globals.css';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: { to: string; children: React.ReactNode; className?: string },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/automations/review/versions' }),
  useSearch: () => ({}),
}));

afterEach(async () => {
  cleanup();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

/**
 * A Windows contrast theme (forced colours) repaints every background and
 * border in the system's own colours, so a choice drawn by a tint or a
 * transparent border is not drawn at all: the strip below reads as one
 * state. Each control that shows its current choice or its progress keeps a
 * system colour for it, which the theme leaves alone.
 */
async function inForcedColors() {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }],
  });
}

/** What the page paints behind everything: `Canvas` in forced colours. */
function canvas(): string {
  return getComputedStyle(document.body).backgroundColor;
}

/**
 * A filled choice: its fill is not the page's colour, its label is not the
 * fill's colour, and the engine leaves both to the control — otherwise it
 * paints a page-coloured backplate behind the label, and a label in the
 * selection pair's light colour is unreadable on it.
 */
function expectReadableFill(element: Element): void {
  const style = getComputedStyle(element);
  expect(style.backgroundColor).not.toBe(canvas());
  expect(style.color).not.toBe(style.backgroundColor);
  expect(style.getPropertyValue('forced-color-adjust')).toBe('none');
}

describe('the current choice and the progress, in forced colours', () => {
  it('draws the chosen option of a segmented control apart from the others', async () => {
    await inForcedColors();
    render(
      <SegmentedControl
        aria-label="View"
        value="list"
        onValueChange={() => undefined}
        options={[
          { value: 'canvas', label: 'Canvas' },
          { value: 'list', label: 'List' },
          { value: 'source', label: 'Source' },
        ]}
      />,
    );
    const chosen = screen.getByRole('radio', { name: 'List' });
    // The group's own surface is the page's colour here, so a chosen option
    // that kept it would look like the rest.
    expectReadableFill(chosen);
    for (const name of ['Canvas', 'Source']) {
      const other = screen.getByRole('radio', { name });
      expect(getComputedStyle(chosen).backgroundColor).not.toBe(
        getComputedStyle(other).backgroundColor,
      );
    }
  });

  it('draws a pressed day chip apart from the others', async () => {
    await inForcedColors();
    render(
      <ToggleChipGroup
        aria-label="Days"
        value={['tu']}
        onValueChange={() => undefined}
        options={[
          { value: 'mo', label: 'Mo', 'aria-label': 'Monday' },
          { value: 'tu', label: 'Tu', 'aria-label': 'Tuesday' },
        ]}
      />,
    );
    const pressed = screen.getByRole('button', { name: 'Tuesday' });
    expectReadableFill(pressed);
    expect(getComputedStyle(pressed).backgroundColor).not.toBe(
      getComputedStyle(screen.getByRole('button', { name: 'Monday' }))
        .backgroundColor,
    );
  });

  it('draws the open tab of an underlined strip apart from the others', async () => {
    await inForcedColors();
    render(
      <Tabs
        variant="underline"
        listAriaLabel="Result"
        value="result"
        items={[
          { value: 'setup', label: 'Setup', content: <p>Setup</p> },
          { value: 'result', label: 'Result', content: <p>Result</p> },
        ]}
      />,
    );
    const open = screen.getByRole('tab', { name: 'Result' });
    const other = screen.getByRole('tab', { name: 'Setup' });
    expect(getComputedStyle(open).borderBottomColor).not.toBe(
      getComputedStyle(other).borderBottomColor,
    );
    // The idle tab's line is the page's own colour: not drawn.
    expect(getComputedStyle(other).borderBottomColor).toBe(canvas());
  });

  it('draws the open tab of a pill strip apart from the others', async () => {
    await inForcedColors();
    render(
      <Tabs
        variant="pill"
        listAriaLabel="View"
        value="two"
        items={[
          { value: 'one', label: 'One', content: <p>One</p> },
          { value: 'two', label: 'Two', content: <p>Two</p> },
        ]}
      />,
    );
    const open = screen.getByRole('tab', { name: 'Two' });
    expectReadableFill(open);
    expect(getComputedStyle(open).backgroundColor).not.toBe(
      getComputedStyle(screen.getByRole('tab', { name: 'One' }))
        .backgroundColor,
    );
  });

  it("draws the open panel's tab of a workbench dock apart from the other", async () => {
    await inForcedColors();
    render(
      <WorkbenchDock
        id="dock"
        panels={[
          { id: 'problems', label: 'Problems', content: <p>None</p> },
          { id: 'tests', label: 'Tests', content: <p>Two</p> },
        ]}
        activeId="tests"
        onActiveChange={() => undefined}
        onClose={() => undefined}
        closeLabel="Close"
      />,
    );
    const open = screen.getByRole('tab', { name: /^Tests/ });
    const other = screen.getByRole('tab', { name: /^Problems/ });
    expect(getComputedStyle(open).borderBottomColor).not.toBe(
      getComputedStyle(other).borderBottomColor,
    );
    expect(getComputedStyle(other).borderBottomColor).toBe(canvas());
  });

  it("draws the line under a page's current tab", async () => {
    await inForcedColors();
    const { container } = render(
      <TabNavigation
        ariaLabel="Automation"
        items={[
          { label: 'Editor', href: '/automations/review/editor' },
          { label: 'Versions', href: '/automations/review/versions' },
        ]}
      />,
    );
    const line = container.querySelector<HTMLElement>(
      'nav > div[aria-hidden="true"].absolute',
    );
    expect(line).not.toBeNull();
    await waitFor(() => expect(line?.offsetWidth).toBeGreaterThan(0));
    expect(getComputedStyle(line as Element).backgroundColor).not.toBe(
      canvas(),
    );
  });

  it('draws the track of a slider, and its filled part apart from it', async () => {
    await inForcedColors();
    const { container } = render(
      <Slider
        aria-label="Position"
        value={40}
        min={0}
        max={100}
        onChange={() => undefined}
      />,
    );
    const [track, fill] = Array.from(
      container.querySelectorAll<HTMLElement>('div[aria-hidden="true"]'),
    );
    expect(track).toBeDefined();
    expect(fill).toBeDefined();
    // The track is an outline round the page's colour; what is filled is
    // solid, so the two read apart whatever the system's selection colour.
    const outline = getComputedStyle(track as Element);
    expect(Number.parseFloat(outline.borderTopWidth)).toBeGreaterThan(0);
    expect(outline.borderTopColor).not.toBe(canvas());
    const filled = getComputedStyle(fill as Element).backgroundColor;
    expect(filled).not.toBe(canvas());
    expect(filled).toBe(outline.borderTopColor);
  });
});

/**
 * Most controls draw their focus as a ring, which is a box-shadow, and turn
 * the browser's own outline off; a contrast theme drops box-shadows, so
 * without a rule of its own nothing would show where the keyboard is.
 */
describe('keyboard focus, in forced colours', () => {
  it('keeps an outline on what has focus', async () => {
    await inForcedColors();
    render(
      <div>
        <Button>Plain</Button>
        <Tabs
          variant="underline"
          listAriaLabel="Result"
          value="a"
          items={[
            { value: 'a', label: 'A', content: null },
            { value: 'b', label: 'B', content: null },
          ]}
        />
        <TestResultList
          items={[{ id: 'one', name: 'First', status: 'passed' }]}
          aria-label="Tests"
          onActivate={() => undefined}
        />
      </div>,
    );
    // Every stop of the keyboard path: the button, the tab, the tab's panel
    // and the row.
    const stops = new Set<Element>();
    for (let press = 0; press < 4; press += 1) {
      await userEvent.tab();
      const focused = document.activeElement;
      expect(focused).not.toBe(document.body);
      stops.add(focused as Element);
      // Controls that transition `all` draw the outline in over 150 ms.
      await waitFor(() => {
        const outline = getComputedStyle(focused as Element);
        expect(outline.outlineStyle).not.toBe('none');
        expect(Number.parseFloat(outline.outlineWidth)).toBeGreaterThanOrEqual(
          2,
        );
        expect(outline.outlineColor).not.toBe(canvas());
      });
    }
    expect(stops.size).toBe(4);
    expect(stops.has(screen.getByRole('button', { name: /First/ }))).toBe(true);
  });
});
