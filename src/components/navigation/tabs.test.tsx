import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Tabs } from './tabs';

describe('Tabs', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Tabs
          defaultValue="tab1"
          items={[
            {
              value: 'tab1',
              label: 'First Tab',
              content: <p>First content</p>,
            },
            {
              value: 'tab2',
              label: 'Second Tab',
              content: <p>Second content</p>,
            },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with disabled tab', async () => {
      const { container } = render(
        <Tabs
          defaultValue="tab1"
          items={[
            { value: 'tab1', label: 'Active', content: <p>Active content</p> },
            { value: 'tab2', label: 'Disabled', disabled: true },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});

describe('overflow menu full-hide (partially fitting tabs)', () => {
  const stubLayout = (
    list: HTMLElement,
    rights: number[],
    clientWidth: number,
  ) => {
    Object.defineProperty(list, 'clientWidth', {
      configurable: true,
      get: () => clientWidth,
    });
    Object.defineProperty(list, 'scrollWidth', {
      configurable: true,
      get: () => Math.max(clientWidth, ...rights),
    });
    // Real DOMRects (right = x + width), not narrowing casts — the lint
    // forbids asserting object literals into the full DOMRect shape.
    list.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    const triggers = list.querySelectorAll<HTMLElement>('[role="tab"]');
    triggers.forEach((trigger, index) => {
      trigger.getBoundingClientRect = () =>
        new DOMRect(rights[index] ?? 0, 0, 0, 0);
    });
  };

  const items = (suffix = '') => [
    { value: 'a', label: `Alpha${suffix}` },
    { value: 'b', label: `Beta${suffix}` },
    { value: 'c', label: `Gamma${suffix}` },
  ];

  it('hides the first tab that does not fit completely, and the rest', () => {
    const { container, rerender } = render(
      <Tabs defaultValue="a" overflowMenu items={items()} />,
    );
    const list = container.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) throw new Error('tablist missing');
    // Third tab starts inside the row but its right edge crosses it — the
    // half-clipped sliver Larry flagged. It must vanish entirely.
    stubLayout(list, [100, 200, 260], 220);
    // The measurement effect re-runs on an items identity change.
    rerender(<Tabs defaultValue="a" overflowMenu items={items()} />);

    const triggers = [
      ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    if (!triggers[2]?.className.includes('invisible')) {
      throw new Error('overflowing tab must be invisible');
    }
    if (triggers[0]?.className.includes('invisible')) {
      throw new Error('fitting tab must stay visible');
    }
    // The strip must not scroll under the menu — the menu is the one path.
    if (!list.className.includes('overflow-x-hidden')) {
      throw new Error('strip must not scroll when the menu owns overflow');
    }
  });

  it('marks the More trigger current when the SELECTED tab is overflowed', () => {
    // A hidden tab sits past the clip edge and cannot show its own selected
    // state — without the stand-in the strip reads as "nothing selected".
    const { container, rerender } = render(
      <Tabs defaultValue="c" overflowMenu items={items()} />,
    );
    const list = container.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) throw new Error('tablist missing');
    stubLayout(list, [100, 200, 260], 220);
    rerender(<Tabs defaultValue="c" overflowMenu items={items()} />);

    const more = container.querySelector<HTMLElement>('[aria-label="More"]');
    if (!more) throw new Error('overflow trigger missing');
    if (more.getAttribute('aria-current') !== 'true') {
      throw new Error('More must carry aria-current for a hidden selection');
    }
    if (!more.className.includes('bg-tab')) {
      throw new Error('More must carry the active-tab styling stand-in');
    }
  });

  it('keeps the More trigger neutral while the selected tab is visible', () => {
    const { container, rerender } = render(
      <Tabs defaultValue="a" overflowMenu items={items()} />,
    );
    const list = container.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) throw new Error('tablist missing');
    stubLayout(list, [100, 200, 260], 220);
    rerender(<Tabs defaultValue="a" overflowMenu items={items()} />);

    const more = container.querySelector<HTMLElement>('[aria-label="More"]');
    if (!more) throw new Error('overflow trigger missing');
    if (more.getAttribute('aria-current') !== null) {
      throw new Error('More must not claim currency for a visible selection');
    }
  });

  it('shows every tab again when the row fits', () => {
    const { container, rerender } = render(
      <Tabs defaultValue="a" overflowMenu items={items()} />,
    );
    const list = container.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) throw new Error('tablist missing');
    stubLayout(list, [100, 200, 260], 220);
    rerender(<Tabs defaultValue="a" overflowMenu items={items()} />);
    stubLayout(list, [100, 200, 260], 400);
    rerender(<Tabs defaultValue="a" overflowMenu items={items()} />);

    const invisible = [
      ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].filter((trigger) => trigger.className.includes('invisible'));
    if (invisible.length > 0) {
      throw new Error('no tab may stay hidden once the row fits');
    }
  });
});

// A view-switching strip (Board / List) renders no panels; Radix would still
// stamp `aria-controls` with the id of a Content that never exists (axe
// `aria-valid-attr-value`, critical).
describe('Tabs without panels', () => {
  it('omits aria-controls on a trigger that has no content', async () => {
    const { container } = render(
      <Tabs
        defaultValue="board"
        listAriaLabel="View"
        items={[
          { value: 'board', label: 'Board' },
          { value: 'list', label: 'List' },
        ]}
      />,
    );
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-controls');
    }
    await checkAccessibility(container);
  });

  it('keeps aria-controls when the tab has a panel', () => {
    render(
      <Tabs
        defaultValue="a"
        items={[{ value: 'a', label: 'A', content: <p>A panel</p> }]}
      />,
    );
    const tab = screen.getByRole('tab', { name: 'A' });
    expect(tab).toHaveAttribute('aria-controls');
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'id',
      tab.getAttribute('aria-controls'),
    );
  });
});
