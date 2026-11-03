import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

/** Where the router says the person is: a test sets it before it shows the frame. */
const where = vi.hoisted(() => ({ pathname: '/proxies', statusCode: 200 }));

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return {
    ...createRouterStub(),
    useLocation: () => ({ pathname: where.pathname }),
    useRouterState: ({
      select,
    }: {
      select: (state: {
        location: { pathname: string };
        statusCode: number;
      }) => unknown;
    }) =>
      select({
        location: { pathname: where.pathname },
        statusCode: where.statusCode,
      }),
  };
});

import { AppFrame } from './app-frame';

function show() {
  return renderApp(
    <AppFrame>
      <h1>Proxies</h1>
    </AppFrame>,
  );
}

beforeEach(() => {
  where.pathname = '/proxies';
  where.statusCode = 200;
});

/** Whether `later` comes after `earlier` in the document. */
function follows(earlier: Element, later: Element): boolean {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe('AppFrame', () => {
  it('holds the page in the one main landmark, which the skip link can focus', () => {
    installFakeApi({ 'GET /meta': meta() });
    show();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(
      within(main).getByRole('heading', { level: 1, name: 'Proxies' }),
    ).toBeVisible();
  });

  it('shows the rail beside the page, and the tab bar of a phone', () => {
    installFakeApi({ 'GET /meta': meta() });
    show();
    const rail = screen.getByRole('complementary', {
      name: 'Session Manager sidebar',
    });
    expect(rail.parentElement).toBe(screen.getByRole('main').parentElement);
    expect(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).toBeInTheDocument();
  });

  it('shows a notice in front of the rail and the page, as a strip of its own, never inside the page', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
    });
    show();
    const notice = await screen.findByRole('alert');
    const rail = screen.getByRole('complementary');
    const main = screen.getByRole('main');

    // In front of both, so a header of the page stays on the rail's line.
    expect(follows(notice, rail)).toBe(true);
    expect(follows(notice, main)).toBe(true);
    expect(main).not.toContainElement(notice);
    expect(rail).not.toContainElement(notice);
    // Above the row that holds the rail and the page, not one of its cells.
    expect(notice.parentElement).toBe(rail.parentElement?.parentElement);
  });

  it('shows no strip while there is nothing to say', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    show();
    await expect.poll(() => api.callsTo('GET /meta').length).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no accessibility violations, with a notice above it', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
    });
    const view = show();
    await screen.findByRole('alert');
    await checkAccessibility(view);
  });
});

/*
 * The bar above the page on a phone holds the title a page puts in the adaptive
 * header. A `header` inside `main` has no landmark role, so the element is the
 * only handle there is.
 */
describe('AppFrame: the bar of a phone', () => {
  const bar = () => screen.getByRole('main').querySelector('header');

  function TitledPage() {
    return (
      <AdaptiveHeaderRoot>
        <AdaptiveHeaderTitle>Proxies</AdaptiveHeaderTitle>
      </AdaptiveHeaderRoot>
    );
  }

  it('is drawn above a page that puts its title there, and holds the title', () => {
    installFakeApi({ 'GET /meta': meta() });
    renderApp(
      <AppFrame>
        <TitledPage />
      </AppFrame>,
    );
    const phoneBar = bar();
    expect(phoneBar).not.toBeNull();
    if (phoneBar === null) return;
    // Hidden from the tree on a computer, where the page's own copy of the title shows.
    expect(
      within(phoneBar).getByRole('heading', {
        level: 1,
        name: 'Proxies',
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  it('is left out on the page of a session, which brings a header of its own', () => {
    installFakeApi({ 'GET /meta': meta() });
    where.pathname = '/sessions/12';
    show();
    // Else an empty row, with a line under it, would stand above its header.
    expect(bar()).toBeNull();
    expect(
      within(screen.getByRole('main')).getByRole('heading', { level: 1 }),
    ).toBeVisible();
  });

  it('is left out on the page that says there is no page, which puts no title in it', () => {
    installFakeApi({ 'GET /meta': meta() });
    where.pathname = '/nowhere/at/all';
    where.statusCode = 404;
    show();
    expect(bar()).toBeNull();
  });
});
