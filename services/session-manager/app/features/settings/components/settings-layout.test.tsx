import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta, settings } from '@/tests/utils/fixtures';
import { renderSettings } from '@/tests/utils/settings-router';

beforeEach(() => {
  installFakeApi({
    'GET /settings': settings(),
    'GET /meta': meta(),
    'PATCH /settings': settings(),
  });
});

const title = () => screen.getByRole('heading', { level: 1 });
const panel = () => screen.getByRole('navigation', { name: 'Settings pages' });

describe('Settings on a computer', () => {
  it('lists General, Appearance and AI access in the panel, naming the section', async () => {
    renderSettings({ at: '/settings/general' });
    await screen.findByRole('heading', { level: 1, name: 'General' });

    expect(
      within(panel()).getByRole('heading', { level: 2, name: 'Settings' }),
    ).toBeInTheDocument();
    expect(
      within(panel())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['General', 'Appearance', 'AI access']);
  });

  it.each([
    ['/settings/general', 'General'],
    ['/settings/appearance', 'Appearance'],
    ['/settings/ai-access', 'AI access'],
  ])(
    'marks %s as the open page and names it in the header',
    async (at, name) => {
      renderSettings({ at });
      await screen.findByRole('heading', { level: 1, name });

      const current = within(panel()).getAllByRole('link', { current: 'page' });
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent(name);
      // The panel names the section, so the header names only the page.
      expect(title()).toHaveTextContent(new RegExp(`^${name}$`));
    },
  );

  it('has one h1 on the page', async () => {
    renderSettings({ at: '/settings/ai-access' });
    await screen.findByRole('heading', { level: 1, name: 'AI access' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps its sections together under one container that draws the line between them, whatever wraps a section', async () => {
    renderSettings({ at: '/settings/general' });
    const about = await screen.findByRole('region', { name: 'About' });
    const sessions = screen.getByRole('region', { name: 'New sessions' });

    // The line between the two is the container's, keyed on the marker of a
    // section (jsdom draws nothing, so the rule is read in its class).
    expect(about.parentElement).toBe(sessions.parentElement);
    expect(about.parentElement?.className).toContain('[data-settings-section]');
  });

  it('moves to a page when its row is clicked, and the header follows', async () => {
    const { user, router } = renderSettings({ at: '/settings/general' });
    await screen.findByRole('heading', { level: 1, name: 'General' });

    await user.click(within(panel()).getByRole('link', { name: 'Appearance' }));

    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    expect(router.state.location.pathname).toBe('/settings/appearance');
    expect(
      within(panel()).getByRole('link', { name: 'Appearance' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(panel()).getByRole('link', { name: 'General' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('reaches every page from the keyboard', async () => {
    const { user, router } = renderSettings({ at: '/settings/general' });
    await screen.findByRole('heading', { level: 1, name: 'General' });

    within(panel()).getByRole('link', { name: 'General' }).focus();
    await user.tab();
    expect(
      within(panel()).getByRole('link', { name: 'Appearance' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'AI access' });
    expect(router.state.location.pathname).toBe('/settings/ai-access');
  });

  it('opens Settings on General, replacing the index in the history', async () => {
    const { router } = renderSettings({ at: '/settings' });

    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(router.state.location.pathname).toBe('/settings/general');
    // Back does not land on the index and bounce forward again.
    expect(router.history.length).toBe(1);
  });

  it('has no accessibility violations on any page', async () => {
    for (const [at, name] of [
      ['/settings/general', 'General'],
      ['/settings/appearance', 'Appearance'],
      ['/settings/ai-access', 'AI access'],
    ] as const) {
      const view = renderSettings({ at });
      await screen.findByRole('heading', { level: 1, name });
      await waitFor(() =>
        expect(
          screen.queryByRole('status', { name: 'Loading content' }),
        ).toBeNull(),
      );
      await checkAccessibility(view);
      view.unmount();
    }
  });
});

describe('Settings on a phone', () => {
  it('lists the pages instead of opening one, for there is no panel', async () => {
    const { router } = renderSettings({ at: '/settings', viewport: 'phone' });

    const list = await screen.findByRole('navigation', { name: 'Settings' });
    expect(router.state.location.pathname).toBe('/settings');
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/settings/general',
      '/settings/appearance',
      '/settings/ai-access',
    ]);
    expect(within(list).getByText('Theme and language.')).toBeInTheDocument();
  });

  it('names the section in the header of the list, with nowhere to go back to', async () => {
    renderSettings({ at: '/settings', viewport: 'phone' });
    await screen.findByRole('navigation', { name: 'Settings' });

    expect(title()).toHaveTextContent('Settings');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('opens a page from the list, and back returns to the list', async () => {
    const { user, router } = renderSettings({
      at: '/settings',
      viewport: 'phone',
    });
    const list = await screen.findByRole('navigation', { name: 'Settings' });

    await user.click(within(list).getByRole('link', { name: /Appearance/ }));
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    expect(router.state.location.pathname).toBe('/settings/appearance');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('navigation', { name: 'Settings' });
    expect(router.state.location.pathname).toBe('/settings');
    expect(title()).toHaveTextContent('Settings');
  });

  it('goes back to the list from a page it was opened on directly', async () => {
    const { user, router } = renderSettings({
      at: '/settings/ai-access',
      viewport: 'phone',
    });
    await screen.findByRole('heading', { level: 1, name: 'AI access' });

    await user.click(screen.getByRole('button', { name: 'Back' }));

    await screen.findByRole('navigation', { name: 'Settings' });
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('opens General when the window grows past the phone breakpoint with the list open', async () => {
    const { router, resize } = renderSettings({
      at: '/settings',
      viewport: 'phone',
    });
    await screen.findByRole('navigation', { name: 'Settings' });

    act(() => resize('desktop'));

    await screen.findByRole('heading', { level: 1, name: 'General' });
    expect(router.state.location.pathname).toBe('/settings/general');
  });

  it('has no accessibility violations on the list or on a page', async () => {
    const view = renderSettings({ at: '/settings', viewport: 'phone' });
    await screen.findByRole('navigation', { name: 'Settings' });
    await checkAccessibility(view);
    view.unmount();

    const page = renderSettings({
      at: '/settings/appearance',
      viewport: 'phone',
    });
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    await checkAccessibility(page);
  });
});
