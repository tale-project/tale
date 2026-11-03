import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

const navigate = vi.hoisted(() => vi.fn());

/** What the shared hooks answer in a test: the keyboard of a phone, and how far the page has scrolled. */
const phone = vi.hoisted(() => ({
  keyboard: { open: false, height: undefined as number | undefined },
  compact: false,
  expand: vi.fn(),
  scrollArguments: [] as unknown[][],
}));

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return {
    ...createRouterStub('/secrets/3'),
    useNavigate: () => navigate,
  };
});

vi.mock('@tale/ui/use-mobile-keyboard', () => ({
  useMobileKeyboard: () => phone.keyboard,
}));

vi.mock('@tale/ui/use-scroll-compact', () => ({
  useScrollCompact: (...args: unknown[]) => {
    phone.scrollArguments.push(args);
    return { compact: phone.compact, expand: phone.expand };
  },
}));

import { MobileNav } from './mobile-nav';

beforeEach(() => {
  phone.keyboard = { open: false, height: undefined };
  phone.compact = false;
  phone.expand.mockClear();
  phone.scrollArguments = [];
});

afterEach(async () => {
  navigate.mockClear();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('MobileNav', () => {
  it('shows the same sections as the rail, with Settings last', () => {
    renderApp(<MobileNav />);
    const bar = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(bar).toBeInTheDocument();
    for (const name of ['Sessions', 'Proxies', 'Secrets', 'Settings']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the section of a page beneath it as current', () => {
    renderApp(<MobileNav />);
    expect(screen.getByRole('button', { name: 'Secrets' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the first page of a section on a tap', async () => {
    const { user } = renderApp(<MobileNav />);
    await user.click(screen.getByRole('button', { name: 'Proxies' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/proxies' });
  });

  it.each([
    ['de', 'Hauptnavigation', 'Sitzungen'],
    ['fr', 'Navigation principale', 'Sessions'],
  ])(
    'is named like the rail in %s, one name for the navigation of the app, as on the platform',
    async (locale, navigation, sessions) => {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      renderApp(<MobileNav />);
      expect(
        await screen.findByRole('navigation', { name: navigation }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: sessions })).toBeVisible();
    },
  );

  it('has no accessibility violations', async () => {
    const view = renderApp(<MobileNav />);
    await checkAccessibility(view);
  });
});

describe('MobileNav and the software keyboard', () => {
  it('marks the document while the keyboard is open, with the height that is left, so that the shell fits above it', () => {
    phone.keyboard = { open: true, height: 420 };
    const { unmount } = renderApp(<MobileNav />);
    const root = document.documentElement;
    expect(root).toHaveAttribute('data-mobile-keyboard');
    expect(root.style.getPropertyValue('--mobile-visual-height')).toBe('420px');

    unmount();
    expect(root).not.toHaveAttribute('data-mobile-keyboard');
    expect(root.style.getPropertyValue('--mobile-visual-height')).toBe('');
  });

  it('leaves the document unmarked while the keyboard is closed', () => {
    renderApp(<MobileNav />);
    expect(document.documentElement).not.toHaveAttribute(
      'data-mobile-keyboard',
    );
    expect(
      document.documentElement.style.getPropertyValue('--mobile-visual-height'),
    ).toBe('');
  });

  it('follows the keyboard as it opens and closes', () => {
    const { rerender } = renderApp(<MobileNav />);
    phone.keyboard = { open: true, height: 380 };
    rerender(<MobileNav />);
    expect(document.documentElement).toHaveAttribute('data-mobile-keyboard');

    phone.keyboard = { open: false, height: undefined };
    rerender(<MobileNav />);
    expect(document.documentElement).not.toHaveAttribute(
      'data-mobile-keyboard',
    );
  });
});

describe('MobileNav and scrolling', () => {
  it('shrinks to its icons once the page has scrolled', () => {
    phone.compact = true;
    renderApp(<MobileNav />);
    expect(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).toHaveAttribute('data-compact', 'true');
  });

  it('is full size while the page is at its top', () => {
    renderApp(<MobileNav />);
    expect(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).not.toHaveAttribute('data-compact');
  });

  it('starts again on every page, and holds still while the keyboard is open', () => {
    phone.keyboard = { open: true, height: 400 };
    renderApp(<MobileNav />);
    expect(phone.scrollArguments.at(-1)).toEqual(['/secrets/3', true]);
  });

  it('grows back to full size on a tap', async () => {
    phone.compact = true;
    const { user } = renderApp(<MobileNav />);
    await user.click(screen.getByRole('button', { name: 'Proxies' }));
    expect(phone.expand).toHaveBeenCalled();
  });

  it('grows back to full size when the keyboard reaches a tab', async () => {
    phone.compact = true;
    const { user } = renderApp(<MobileNav />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveFocus();
    expect(phone.expand).toHaveBeenCalled();
  });
});
