import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import {
  Inbox,
  Layers,
  ListChecks,
  MessageCircle,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { SegmentedControl } from './segmented-control';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

function ControlledSegments() {
  const [value, setValue] = useState('all');
  return (
    <SegmentedControl
      aria-label="Which pages to show"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'all', label: 'All' },
        { value: 'failed', label: 'Failed' },
      ]}
    />
  );
}

it('keeps newer keyboard selection when an older navigation reset runs', async () => {
  render(<ControlledSegments />);
  const all = screen.getByRole('radio', { name: 'All' });
  const failed = screen.getByRole('radio', { name: 'Failed' });
  await userEvent.click(all);

  // Chromium can deliver the next key after focus but before the prior key's
  // reset timer. Hold only timers created during native keydown to reproduce
  // that legal ordering deterministically, without mocking focus or key input.
  const nativeTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClear = globalThis.clearTimeout.bind(globalThis);
  const pending: Array<() => void> = [];
  const active = new Set<unknown>();
  let capturing = false;
  const startCapture = () => {
    capturing = true;
  };
  const endCapture = () => {
    capturing = false;
  };
  window.addEventListener('keydown', startCapture, true);
  window.addEventListener('keydown', endCapture);
  const timeout = vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((callback, delay, ...args) => {
      if (!capturing || typeof callback !== 'function' || (delay ?? 0) !== 0) {
        return nativeTimeout(callback, delay, ...args);
      }
      const id = nativeTimeout(() => {}, 0);
      active.add(id);
      pending.push(() => {
        if (active.delete(id)) callback(...args);
      });
      return id;
    });
  const clear = vi
    .spyOn(globalThis, 'clearTimeout')
    .mockImplementation((id) => {
      active.delete(id);
      nativeClear(id);
    });
  const runNext = () => {
    const next = pending.shift();
    expect(next).toBeDefined();
    act(() => next?.());
  };

  try {
    await userEvent.keyboard('{ArrowRight}');
    runNext();
    expect(failed).toHaveFocus();
    expect(failed).toHaveAttribute('aria-checked', 'true');

    await userEvent.keyboard('{ArrowLeft}');
    runNext(); // The previous key's reset must not erase the newer intent.
    runNext(); // Radix focuses All for ArrowLeft.
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(failed).toHaveAttribute('aria-checked', 'false');
  } finally {
    window.removeEventListener('keydown', startCapture, true);
    window.removeEventListener('keydown', endCapture);
    timeout.mockRestore();
    clear.mockRestore();
    active.clear();
  }
});

const VIEWS = [
  { value: 'all', label: 'Alle', icon: Layers },
  {
    value: 'chats',
    label: 'Chats',
    icon: MessageCircle,
    attention: '2 Einträge warten auf dich',
  },
  { value: 'tasks', label: 'Aufgaben', icon: ListChecks },
  { value: 'inbox', label: 'Inbox', icon: Inbox },
  { value: 'automations', label: 'Automatisierungen', icon: Workflow },
];

function IconLed({
  width,
  count = 4,
  initial = 'all',
}: {
  width: number;
  count?: number;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div data-testid="column" style={{ width }}>
      <SegmentedControl
        aria-label="Anzeigen"
        labels="selected"
        value={value}
        onValueChange={setValue}
        options={VIEWS.slice(0, count)}
      />
    </div>
  );
}

/** Ends every transition at once, as the eye sees it once it has run. */
function settle() {
  for (const animation of document.getAnimations()) animation.finish();
}

function box(element: Element) {
  return element.getBoundingClientRect();
}

function frameOf(radio: HTMLElement) {
  // oxlint-disable-next-line testing-library/no-node-access -- the frame is how the label opens; it has no role
  const frame = radio.querySelector('[data-slot="segmented-label-frame"]');
  // oxlint-disable-next-line testing-library/no-node-access -- see above
  const label = frame?.querySelector('[data-slot="segmented-label"]');
  if (!(frame instanceof HTMLElement) || !(label instanceof HTMLElement)) {
    throw new Error('The option has no label frame');
  }
  return { frame, label };
}

function thumb() {
  // oxlint-disable-next-line testing-library/no-node-access -- the thumb is decorative, so it has no role
  const element = document.querySelector('[data-slot="segmented-thumb"]');
  if (!(element instanceof HTMLElement)) throw new Error('No thumb');
  return element;
}

/** The labels a reader sees in full; a label is never cut short. */
function shownLabels() {
  return screen.getAllByRole('radio').flatMap((radio) => {
    const { frame, label } = frameOf(radio);
    const open = box(frame).width;
    if (open === 0) return [];
    expect(open, radio.textContent ?? '').toBeGreaterThanOrEqual(
      box(label).width - 0.5,
    );
    return [label.textContent];
  });
}

describe('SegmentedControl with labels="selected", laid out', () => {
  it('opens the chosen label in full beside the other options icons', async () => {
    render(<IconLed width={222} />);
    await waitFor(() => expect(thumb().style.opacity).toBe('1'));
    settle();
    expect(shownLabels()).toEqual(['Alle']);
    for (const radio of screen.getAllByRole('radio').slice(1)) {
      expect(box(radio).width).toBeLessThanOrEqual(28.5);
    }
    const chosen = box(screen.getByRole('radio', { name: 'Alle' }));
    expect(box(thumb()).left).toBeCloseTo(chosen.left, 0);
    expect(box(thumb()).width).toBeCloseTo(chosen.width, 0);
  });

  it('glides the thumb straight to where the chosen option lands', async () => {
    render(<IconLed width={222} />);
    await waitFor(() => expect(thumb().style.opacity).toBe('1'));
    settle();
    await userEvent.click(screen.getByRole('radio', { name: 'Aufgaben' }));
    // Aimed at the option's final box from the first frame, so the thumb
    // and the opening label run on one timing instead of one chasing the
    // other.
    const aimed = parseFloat(thumb().style.width);
    settle();
    const tasks = box(screen.getByRole('radio', { name: 'Aufgaben' }));
    expect(aimed).toBeCloseTo(tasks.width, 0);
    expect(box(thumb()).left).toBeCloseTo(tasks.left, 0);
    expect(shownLabels()).toEqual(['Aufgaben']);
  });

  it('folds the chosen label to its icon when even it has no room, and opens it again with room', async () => {
    const { rerender } = render(
      <IconLed width={222} count={5} initial="automations" />,
    );
    // Folded from the first paint, not closing in front of the reader.
    expect(shownLabels()).toEqual([]);
    const column = box(screen.getByTestId('column'));
    for (const radio of screen.getAllByRole('radio')) {
      expect(box(radio).right).toBeLessThanOrEqual(column.right);
    }
    rerender(<IconLed width={340} count={5} initial="automations" />);
    await waitFor(() => {
      settle();
      expect(shownLabels()).toEqual(['Automatisierungen']);
    });
    for (const radio of screen.getAllByRole('radio')) {
      expect(box(radio).right).toBeLessThanOrEqual(
        box(screen.getByTestId('column')).right,
      );
    }
  });

  it("shows an icon's name in a tooltip on hover, but not the chosen option's", async () => {
    render(<IconLed width={222} />);
    // The chosen option already shows its name beside its icon.
    await userEvent.hover(screen.getByRole('radio', { name: 'Alle' }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.hover(screen.getByRole('radio', { name: /^Chats/ }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chats');
  });

  it('opens the label and moves the thumb without motion when motion is reduced', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    render(<IconLed width={222} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Inbox' }));
    const { frame } = frameOf(screen.getByRole('radio', { name: 'Inbox' }));
    for (const element of [frame, thumb()]) {
      expect(getComputedStyle(element).transitionProperty).toBe('none');
    }
  });
});
