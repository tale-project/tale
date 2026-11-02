import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TabInfo } from '@/lib/live-view';
import { checkAccessibility } from '@/tests/utils/a11y';
import { ControlledResizeObserver } from '@/tests/utils/live-view';
import { renderApp } from '@/tests/utils/render';

import { LINE_HEIGHT } from '../lib/wheel';
import { TabStrip } from './tab-strip';

function tab(id: number, overrides: Partial<TabInfo> = {}): TabInfo {
  return {
    id,
    url: `https://site${id}.example.com/page`,
    title: `Page ${id}`,
    loading: false,
    active: false,
    ...overrides,
  };
}

const tabs = [
  tab(1, { active: true }),
  tab(2),
  tab(3, { title: '', url: 'https://news.example.org/a/b' }),
];

function setup(props: Partial<React.ComponentProps<typeof TabStrip>> = {}) {
  const handlers = {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
  };
  const view = renderApp(
    <TabStrip tabs={tabs} disabled={false} {...handlers} {...props} />,
  );
  return { ...view, ...handlers };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TabStrip', () => {
  it('lists the tabs as a tab list, each by its title, or by its host without one', () => {
    setup();
    const list = screen.getByRole('tablist', { name: 'Open tabs' });
    expect(
      within(list)
        .getAllByRole('tab')
        .map((item) => item.textContent),
    ).toEqual(['Page 1', 'Page 2', 'news.example.org']);
  });

  it('calls a tab that has loaded nothing a new tab', () => {
    setup({ tabs: [tab(1, { active: true, title: '', url: '' })] });
    expect(screen.getByRole('tab', { name: 'New tab' })).toBeVisible();
  });

  it('marks the active tab and makes it the one stop of the tab key', () => {
    setup();
    const [first, second] = screen.getAllByRole('tab');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(second).toHaveAttribute('tabindex', '-1');
  });

  it('makes the first tab the stop of the tab key while none is active', () => {
    setup({ tabs: [tab(1), tab(2)] });
    expect(screen.getAllByRole('tab').map((item) => item.tabIndex)).toEqual([
      0, -1,
    ]);
  });

  it('says that a tab is loading', () => {
    setup({ tabs: [tab(1, { active: true }), tab(2, { loading: true })] });
    const [first, second] = screen.getAllByRole('tab');
    expect(first).not.toHaveAttribute('aria-busy');
    expect(second).toHaveAttribute('aria-busy', 'true');
  });

  it('announces Delete as the way to close the tab that has the focus', () => {
    setup();
    for (const item of screen.getAllByRole('tab')) {
      expect(item).toHaveAttribute('aria-keyshortcuts', 'Delete');
    }
  });

  it('activates a tab that is clicked, keeping the keyboard for the page', async () => {
    const { user, onActivate } = setup();
    await user.click(screen.getByRole('tab', { name: 'Page 2' }));
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(2, 'pointer');
  });

  it('moves between the tabs with the arrow keys, round the end, and keeps the keyboard on the tabs', async () => {
    const { user, onActivate } = setup();
    screen.getByRole('tab', { name: 'Page 1' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onActivate).toHaveBeenLastCalledWith(2, 'keyboard');
    expect(screen.getByRole('tab', { name: 'Page 2' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onActivate).toHaveBeenLastCalledWith(3, 'keyboard');
    await user.keyboard('{ArrowRight}');
    expect(onActivate).toHaveBeenLastCalledWith(1, 'keyboard');
    expect(screen.getByRole('tab', { name: 'Page 1' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(onActivate).toHaveBeenLastCalledWith(3, 'keyboard');
  });

  it('goes to the first and the last tab with Home and End', async () => {
    const { user, onActivate } = setup();
    screen.getByRole('tab', { name: 'Page 2' }).focus();
    await user.keyboard('{End}');
    expect(onActivate).toHaveBeenLastCalledWith(3, 'keyboard');
    await user.keyboard('{Home}');
    expect(onActivate).toHaveBeenLastCalledWith(1, 'keyboard');
  });

  it('closes a tab with its own button, named by the tab, without activating it', async () => {
    const { user, onClose, onActivate } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Close tab "Page 2"' }),
    );
    expect(onClose).toHaveBeenCalledExactlyOnceWith(2);
    expect(onActivate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Close tab "news.example.org"' }),
    ).toBeVisible();
  });

  it('says in the button of the last tab that closing it stops the session', () => {
    setup({ tabs: [tab(1, { active: true })] });
    expect(
      screen.getByRole('button', {
        name: 'Close tab "Page 1" and stop the session',
      }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close tab "Page 1"' })).toBe(
      null,
    );
  });

  it('keeps the plain name for the buttons of the tabs that are not the last', () => {
    setup();
    expect(screen.getAllByRole('button', { name: /^Close tab / })).toHaveLength(
      3,
    );
    expect(screen.queryByText(/and stop the session/)).toBeNull();
  });

  it('closes the tab that has the focus with Delete, and moves the focus to its neighbour', async () => {
    const { user, onClose } = setup();
    screen.getByRole('tab', { name: 'Page 2' }).focus();
    await user.keyboard('{Delete}');
    expect(onClose).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getByRole('tab', { name: 'news.example.org' })).toHaveFocus();
  });

  it('moves the focus to the tab before when the last one is closed with Delete', async () => {
    const { user, onClose } = setup();
    screen.getByRole('tab', { name: 'news.example.org' }).focus();
    await user.keyboard('{Delete}');
    expect(onClose).toHaveBeenCalledExactlyOnceWith(3);
    expect(screen.getByRole('tab', { name: 'Page 2' })).toHaveFocus();
  });

  it('does not close a tab with Delete while the connection is not live', async () => {
    const { user, onClose } = setup({ disabled: true });
    screen.getByRole('tab', { name: 'Page 2' }).focus();
    await user.keyboard('{Delete}');
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('where the focus goes when a tab is closed with its button', () => {
    it('moves it to the next tab when the button is used from the keyboard', async () => {
      const { user, onClose } = setup();
      const close = screen.getByRole('button', { name: 'Close tab "Page 1"' });
      close.focus();
      await user.keyboard('{Enter}');
      expect(onClose).toHaveBeenCalledExactlyOnceWith(1);
      expect(screen.getByRole('tab', { name: 'Page 2' })).toHaveFocus();
    });

    it('moves it to the tab before when the closed one was the last of the list', async () => {
      const { user, onClose } = setup({
        tabs: [tab(1), tab(2), tab(3, { active: true })],
      });
      const close = screen.getByRole('button', { name: 'Close tab "Page 3"' });
      close.focus();
      await user.keyboard('{Enter}');
      expect(onClose).toHaveBeenCalledExactlyOnceWith(3);
      expect(screen.getByRole('tab', { name: 'Page 2' })).toHaveFocus();
    });

    it('moves it to the new tab button when there is no other tab', async () => {
      const { user, onClose } = setup({ tabs: [tab(1, { active: true })] });
      screen
        .getByRole('button', {
          name: 'Close tab "Page 1" and stop the session',
        })
        .focus();
      await user.keyboard('{Enter}');
      expect(onClose).toHaveBeenCalledExactlyOnceWith(1);
      expect(screen.getByRole('button', { name: 'New tab' })).toHaveFocus();
    });

    it('moves it to a tab when the button was clicked, as it does for the keyboard', async () => {
      const { user, onClose } = setup();
      await user.click(
        screen.getByRole('button', { name: 'Close tab "Page 1"' }),
      );
      expect(onClose).toHaveBeenCalledExactlyOnceWith(1);
      expect(screen.getByRole('tab', { name: 'Page 2' })).toHaveFocus();
    });

    it('leaves the focus alone when it was somewhere else, as when a click gave the button none', () => {
      const { onClose } = setup();
      const elsewhere = document.createElement('button');
      document.body.append(elsewhere);
      elsewhere.focus();
      // Safari does not give a button the focus when it is clicked.
      fireEvent.click(
        screen.getByRole('button', { name: 'Close tab "Page 2"' }),
      );
      expect(onClose).toHaveBeenCalledExactlyOnceWith(2);
      expect(elsewhere).toHaveFocus();
      elsewhere.remove();
    });
  });

  it('keeps the close buttons out of the tab list, and the one of the active tab a stop of the tab key', () => {
    setup();
    const list = screen.getByRole('tablist');
    expect(within(list).queryByRole('button')).toBeNull();
    const closes = screen.getAllByRole('button', { name: /^Close tab / });
    expect(closes.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  });

  it('shows what a close button does, as the other buttons of the strip do', async () => {
    setup();
    screen.getByRole('button', { name: 'Close tab "Page 2"' }).focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Close tab "Page 2"',
    );
  });

  it('closes a tab with a click of the middle button', () => {
    const { onClose } = setup();
    fireEvent(
      screen.getByRole('tab', { name: 'Page 2' }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );
    expect(onClose).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('leaves the other buttons of the mouse to the browser', () => {
    const { onClose } = setup();
    fireEvent(
      screen.getByRole('tab', { name: 'Page 2' }),
      new MouseEvent('auxclick', { bubbles: true, button: 2 }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens a new tab', async () => {
    const { user, onNew } = setup();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  describe('while the connection is not live', () => {
    it('cannot open or close tabs', () => {
      setup({ disabled: true });
      expect(screen.getByRole('button', { name: 'New tab' })).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Close tab "Page 2"' }),
      ).toBeDisabled();
    });

    it('says that the tabs are off, and does nothing when one is chosen', async () => {
      const { user, onActivate } = setup({ disabled: true });
      for (const item of screen.getAllByRole('tab')) {
        expect(item).toHaveAttribute('aria-disabled', 'true');
      }
      await user.click(screen.getByRole('tab', { name: 'Page 2' }));
      screen.getByRole('tab', { name: 'Page 2' }).focus();
      await user.keyboard('{ArrowRight}{End}{Home}');
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('keeps the tabs a stop of the tab key, so that a person can still find them', () => {
      setup({ disabled: true });
      expect(screen.getAllByRole('tab').map((item) => item.tabIndex)).toEqual([
        0, -1, -1,
      ]);
    });

    it('has no accessibility violations', async () => {
      const view = setup({ disabled: true });
      await checkAccessibility(view);
    });
  });

  it('scrolls sideways when the wheel only turns up and down', () => {
    setup();
    const list = screen.getByRole('tablist');
    // The tab list lies in a content box in the element that scrolls.
    const scroller = list.parentElement?.parentElement;
    expect(scroller).toBeTruthy();
    let left = 0;
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
    const notPrevented = fireEvent.wheel(list, { deltaY: 120, deltaX: 0 });
    expect(notPrevented).toBe(false);
    expect(left).toBe(120);
  });

  // Firefox turns the wheel by lines (3 for a notch), some mice by pages: a
  // notch must not move the strip by 3 pixels.
  it('scrolls by what the wheel turns by: lines count for what a line is, and a page for the width of the strip', () => {
    setup();
    const list = screen.getByRole('tablist');
    const scroller = list.parentElement?.parentElement;
    expect(scroller).toBeTruthy();
    let left = 0;
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
    Object.defineProperty(scroller, 'clientWidth', {
      configurable: true,
      get: () => 300,
    });

    fireEvent.wheel(list, { deltaY: 3, deltaX: 0, deltaMode: 1 });
    expect(left).toBe(3 * LINE_HEIGHT);

    left = 0;
    fireEvent.wheel(list, { deltaY: 1, deltaX: 0, deltaMode: 2 });
    expect(left).toBe(300);

    left = 0;
    fireEvent.wheel(list, { deltaY: 100, deltaX: 0, deltaMode: 0 });
    expect(left).toBe(100);
  });

  it('leaves a sideways wheel to the browser', () => {
    setup();
    const notPrevented = fireEvent.wheel(screen.getByRole('tablist'), {
      deltaY: 5,
      deltaX: 80,
    });
    expect(notPrevented).toBe(true);
  });

  describe('when a tab becomes active', () => {
    const strip = { left: 0, right: 300 };

    const box = (left: number, right: number): DOMRect => ({
      left,
      right,
      x: left,
      y: 0,
      top: 0,
      bottom: 32,
      width: right - left,
      height: 32,
      toJSON: () => ({}),
    });

    /**
     * The strip is 300 px wide and scrolled to `scrolled`; the second tab, the
     * one that is about to become active, lies in `second` (an offset in the
     * view of the browser, not in the strip). The tabs need 800 px, or only
     * the 300 when `fits`.
     */
    function arrange(
      scrolled: number,
      second: { left: number; right: number },
      { fits = false } = {},
    ) {
      const { rerender, onActivate, onClose, onNew } = setup();
      const scroller = screen.getByRole('tablist').parentElement?.parentElement;
      if (!scroller) throw new Error('no element that scrolls');
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(
        function (this: Element) {
          return this === scroller ? (fits ? 300 : 800) : 0;
        },
      );
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
        function (this: Element) {
          return this === scroller ? strip.right - strip.left : 0;
        },
      );
      let left = scrolled;
      Object.defineProperty(scroller, 'scrollLeft', {
        configurable: true,
        get: () => left,
        set: (value: number) => {
          left = value;
        },
      });
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          if (this === scroller) return box(strip.left, strip.right);
          if (this.textContent === 'Page 2') {
            return box(second.left, second.right);
          }
          return box(0, 0);
        },
      );
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
      scrollIntoView.mockClear();
      const activateSecond = () =>
        rerender(
          <TabStrip
            tabs={[tab(1), tab(2, { active: true }), tabs[2]]}
            disabled={false}
            onActivate={onActivate}
            onClose={onClose}
            onNew={onNew}
          />,
        );
      return { activateSecond, scrollLeft: () => left, scrollIntoView };
    }

    it('scrolls the strip to it from the right, keeping it clear of the fade at the edge', () => {
      const { activateSecond, scrollLeft } = arrange(0, {
        left: 280,
        right: 400,
      });
      activateSecond();
      // The tab ends 100 px past the edge; the fade is 16 px wide.
      expect(scrollLeft()).toBe(116);
    });

    it('scrolls the strip to it from the left, keeping it clear of the fade at the edge', () => {
      const { activateSecond, scrollLeft } = arrange(200, {
        left: -50,
        right: 60,
      });
      activateSecond();
      expect(scrollLeft()).toBe(134);
    });

    it('leaves the strip alone when the tab is in view already', () => {
      const { activateSecond, scrollLeft } = arrange(40, {
        left: 40,
        right: 140,
      });
      activateSecond();
      expect(scrollLeft()).toBe(40);
    });

    it('leaves the strip alone when it holds all its tabs', () => {
      const { activateSecond, scrollLeft } = arrange(
        0,
        { left: 280, right: 400 },
        { fits: true },
      );
      activateSecond();
      expect(scrollLeft()).toBe(0);
    });

    // The button of the menu of tabs comes after the first measure, and takes
    // room from the strip: a tab brought into view for the room it had before
    // would end up half under the edge, with the fade over it.
    it('brings it into view again when the button of the menu of tabs takes room from the strip', () => {
      // The tabs need 800 px; the strip has 300, and 264 once its menu button is there.
      const offsets = new WeakMap<Element, number>();
      const isStrip = (element: Element) =>
        element.firstElementChild?.firstElementChild?.getAttribute('role') ===
        'tablist';
      const room = () =>
        document.querySelector('[aria-label="More tabs"]') === null ? 300 : 264;
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(
        function (this: Element) {
          return isStrip(this) ? 800 : 0;
        },
      );
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
        function (this: Element) {
          return isStrip(this) ? room() : 0;
        },
      );
      vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(
        function (this: Element) {
          return offsets.get(this) ?? 0;
        },
      );
      vi.spyOn(Element.prototype, 'scrollLeft', 'set').mockImplementation(
        function (this: Element, value: number) {
          offsets.set(this, Math.max(0, Math.min(value, 800 - room())));
        },
      );
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          if (isStrip(this)) return box(0, room());
          if (
            this.getAttribute('role') === 'tab' &&
            this.textContent === 'Page 2'
          ) {
            // It lies 560 to 680 px into the tabs, wherever the strip is scrolled to.
            const scrolled =
              offsets.get(
                this.closest('[role=tablist]')?.parentElement?.parentElement ??
                  this,
              ) ?? 0;
            return box(560 - scrolled, 680 - scrolled);
          }
          return box(0, 0);
        },
      );

      setup({ tabs: [tab(1), tab(2, { active: true }), tab(3)] });

      expect(screen.getByRole('button', { name: 'More tabs' })).toBeVisible();
      const scroller = screen.getByRole('tablist').parentElement?.parentElement;
      // It ends 16 px (the fade) before the edge of the strip as it is now: 264 - 16 = 248.
      expect(scroller?.scrollLeft).toBe(680 - 248);
    });

    // `scrollIntoView` also makes the tab the place the tab key goes on from, so that the
    // first Tab of the page skipped all that comes before the strip and landed past it.
    it('does not use scrollIntoView, which moves the starting point of the tab key', () => {
      const { activateSecond, scrollIntoView } = arrange(0, {
        left: 280,
        right: 400,
      });
      activateSecond();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe('when the tabs do not fit', () => {
    const many = [
      tab(1),
      tab(2, { active: true }),
      tab(3),
      tab(4, { title: '', url: '' }),
      tab(5, { loading: true }),
    ];

    /** The element that scrolls holds the tab list in a content box of its own. */
    const scrolls = (element: Element) =>
      element.firstElementChild?.firstElementChild?.getAttribute('role') ===
      'tablist';

    /** The strip is 300 px wide and its tabs want 800 (or only 300). */
    function overflow(fits: boolean) {
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(
        function (this: Element) {
          return scrolls(this) ? (fits ? 300 : 800) : 0;
        },
      );
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
        function (this: Element) {
          return scrolls(this) ? 300 : 0;
        },
      );
    }

    it('has no list of tabs while they all fit', () => {
      overflow(true);
      setup({ tabs: many });
      expect(screen.queryByRole('button', { name: 'More tabs' })).toBeNull();
    });

    it('offers every tab in a list of its own, named as the tabs are', async () => {
      overflow(false);
      const { user } = setup({ tabs: many });
      await user.click(screen.getByRole('button', { name: 'More tabs' }));
      const menu = await screen.findByRole('menu');
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(['Page 1', 'Page 2', 'Page 3', 'New tab', 'Page 5']);
    });

    it('names each tab of the list by its whole title, however long', async () => {
      overflow(false);
      const title = `${'A long title of a page '.repeat(8)}ends here`;
      const { user } = setup({
        tabs: [tab(1), tab(2, { active: true, title }), tab(3, { title })],
      });
      await user.click(screen.getByRole('button', { name: 'More tabs' }));
      const menu = await screen.findByRole('menu');
      // The drawing cuts a long title short, in the strip and in the list; a
      // screen reader gets the whole of it.
      expect(
        within(menu).getAllByRole('menuitem', { name: title }),
      ).toHaveLength(2);
    });

    it('activates the tab that is chosen in the list, and keeps the keyboard on the strip', async () => {
      overflow(false);
      const { user, onActivate } = setup({ tabs: many });
      await user.click(screen.getByRole('button', { name: 'More tabs' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Page 3' }));
      expect(onActivate).toHaveBeenCalledExactlyOnceWith(3, 'keyboard');
    });

    it('opens from the keyboard and chooses with it', async () => {
      overflow(false);
      const { user, onActivate } = setup({ tabs: many });
      screen.getByRole('button', { name: 'More tabs' }).focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('menu');
      await user.keyboard('{ArrowDown}{Enter}');
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('is off while the connection is not live', () => {
      overflow(false);
      setup({ tabs: many, disabled: true });
      expect(screen.getByRole('button', { name: 'More tabs' })).toBeDisabled();
    });

    it('appears when the strip becomes too small, and goes when it is wide enough again', async () => {
      ControlledResizeObserver.install();
      overflow(true);
      setup({ tabs: many });
      expect(screen.queryByRole('button', { name: 'More tabs' })).toBeNull();
      overflow(false);
      ControlledResizeObserver.resizeAll();
      expect(
        await screen.findByRole('button', { name: 'More tabs' }),
      ).toBeVisible();
      overflow(true);
      ControlledResizeObserver.resizeAll();
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'More tabs' })).toBeNull(),
      );
    });

    it('has no accessibility violations', async () => {
      overflow(false);
      const view = setup({ tabs: many });
      await checkAccessibility(view);
    });
  });

  it('has no accessibility violations', async () => {
    const view = setup({
      tabs: [tab(1, { active: true, loading: true }), tab(2), tab(3)],
    });
    await checkAccessibility(view);
  });

  it('has no accessibility violations without tabs', async () => {
    const view = setup({ tabs: [] });
    await checkAccessibility(view);
  });
});
