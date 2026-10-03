import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { SiteHeader } from './site-header';

const desktopListeners = new Set<(event: MediaQueryListEvent) => void>();

beforeEach(() => {
  desktopListeners.clear();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_event: string, listener: unknown) => {
        if (query === '(min-width: 1024px)') {
          desktopListeners.add(
            listener as (event: MediaQueryListEvent) => void,
          );
        }
      },
      removeEventListener: (_event: string, listener: unknown) => {
        desktopListeners.delete(
          listener as (event: MediaQueryListEvent) => void,
        );
      },
      dispatchEvent: vi.fn(() => true),
    }),
  );
});

function renderNavigation(onOpenChange = vi.fn()) {
  return {
    onOpenChange,
    ...render(
      <>
        <SiteHeader
          openMenuLabel="Open menu"
          closeMenuLabel="Close menu"
          logo={<a href="/">Tale</a>}
          desktopNav={<a href="/desktop">Desktop page</a>}
          mobileNav={
            <>
              <a href="#pricing">Pricing</a>
              <a href="#docs">Documentation</a>
            </>
          }
          onOpenChange={onOpenChange}
        />
        <main>
          <button type="button">Page action</button>
        </main>
      </>,
    ),
  };
}

describe('SiteHeader', () => {
  it('is transparent with a light bottom border at the top of the page', () => {
    const { container } = render(
      <SiteHeader
        openMenuLabel="Open menu"
        closeMenuLabel="Close menu"
        logo={<a href="/">Tale</a>}
        desktopNav={<span>Nav</span>}
        surface="site"
      />,
    );

    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    expect(header?.className).toContain('bg-transparent');
    expect(header?.className).toMatch(/border-border-base\/40/);
    expect(header?.className).not.toMatch(/bg-surface-site/);
  });

  it('stays transparent at the top when surface is omitted', () => {
    const { container } = render(
      <SiteHeader
        openMenuLabel="Open menu"
        closeMenuLabel="Close menu"
        logo={<a href="/">Tale</a>}
      />,
    );

    const header = container.querySelector('header');
    expect(header?.className).toContain('bg-transparent');
    expect(header?.className).toMatch(/border-border-base\/40/);
    expect(header?.className).not.toMatch(/bg-bg-base/);
  });

  it('closes the mobile menu and releases scroll lock at the desktop breakpoint', async () => {
    const { user, onOpenChange } = renderNavigation();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(getComputedStyle(document.body).overflow).toBe('hidden');

    act(() => {
      for (const listener of desktopListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('link', { name: 'Tale' })).toHaveFocus();

    act(() => {
      for (const listener of desktopListeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
    });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps keyboard focus inside the menu and returns it after Escape', async () => {
    const { user } = renderNavigation();
    const opener = screen.getByRole('button', { name: 'Open menu' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Open menu' });
    expect(
      within(dialog).getByRole('button', { name: 'Close menu' }),
    ).toHaveFocus();
    within(dialog).getByRole('link', { name: 'Documentation' }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
  });

  it('releases the page when a resize interrupts the menu exit animation', async () => {
    // jsdom does not execute CSS animations. Give Radix Presence their real
    // lifecycle, but deliberately never fire animationend: a desktop media
    // query can hide the sheet before the browser delivers that event.
    const animationStyle = document.createElement('style');
    animationStyle.textContent = `
      [role="dialog"][data-state="open"] { animation-name: menu-enter; }
      [role="dialog"][data-state="closed"] { animation-name: menu-exit; }
    `;
    document.head.append(animationStyle);
    try {
      const { user } = renderNavigation();
      const pageAction = screen.getByRole('button', { name: 'Page action' });
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.animationStart(dialog, { animationName: 'menu-enter' });
      await user.keyboard('{Escape}');
      expect(dialog).toHaveAttribute('data-state', 'closed');

      act(() => {
        for (const listener of desktopListeners) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });

      await waitFor(() => {
        expect(dialog).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Page action' })).toBe(
          pageAction,
        );
        expect(getComputedStyle(document.body).pointerEvents).not.toBe('none');
      });
    } finally {
      animationStyle.remove();
    }
  });

  it('dismisses after choosing a page and preserves the host body styles', async () => {
    document.body.style.paddingRight = '7px';
    const { user } = renderNavigation();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('link', { name: 'Pricing' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
    expect(document.body.style.paddingRight).toBe('7px');
    document.body.style.paddingRight = '';
  });

  it('renders mobile actions outside the navigation drawer', async () => {
    const onSearch = vi.fn();
    const { user } = render(
      <SiteHeader
        openMenuLabel="Open menu"
        closeMenuLabel="Close menu"
        logo={<a href="/">Tale</a>}
        mobileNav={<a href="#docs">Documentation</a>}
        mobileActions={
          <button type="button" onClick={onSearch}>
            Search documentation
          </button>
        }
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Search documentation' }),
    );
    expect(onSearch).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getComputedStyle(document.body).overflow).not.toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', {
        name: 'Search documentation',
      }),
    ).toBeNull();
  });
});
