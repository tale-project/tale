import '@testing-library/jest-dom/vitest';
import { Button } from '@tale/ui/button';
import { cleanup } from '@testing-library/react';
import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { ACTIVE_HREF, SECTIONS } from './__fixtures__/docs-nav';
import { DocsHeader } from './docs-header';
import { DocsLayout } from './docs-layout';
import { PageActions } from './page-actions';

import '../../globals.css';

// Browser-mode factories cannot reach the file's own imports, so the stub is
// built from the real module and React alone: a `Link` that renders the
// anchor the router would, outside any router context.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Link: ({
      to,
      children,
      activeOptions: _activeOptions,
      ...rest
    }: {
      to: string;
      children: ReactNode;
      activeOptions?: unknown;
    }) => createElement('a', { href: to, ...rest }, children),
    useNavigate: () => () => undefined,
  };
});

beforeEach(async () => {
  // From `md` up the rail is on screen beside the strip; below it the phone
  // bar owns the top and the strip may stack.
  await page.viewport(1280, 800);
});

afterEach(cleanup);

function renderPage(actions: ReactNode) {
  return render(
    <DocsLayout
      sections={SECTIONS}
      activeHref={ACTIVE_HREF}
      homeHref="/"
      homeLabel="Tale documentation home"
      navLabel="Documentation"
      search={{
        indexUrl: '/search-index-en.json',
        recentsStorageKey: 'tale.test.recentSearches.v1',
      }}
      footer={{
        legalLines: ['© 2026 Tale'],
        baseUrl: '/',
        repositoryUrl: 'https://github.com/tale-project/tale',
      }}
    >
      <DocsHeader
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Self-hosted', href: '/self-hosted' },
          { label: 'Run your first self-hosted instance' },
        ]}
        actions={actions}
      />
      <p>Page body</p>
    </DocsLayout>,
  );
}

function bars() {
  const rail = screen.getByRole('navigation', { name: 'Documentation' });
  const logoRow = rail.firstElementChild;
  const strip = screen.getByRole('navigation', {
    name: 'Breadcrumbs',
  }).parentElement;
  if (!logoRow || !strip) throw new Error('docs chrome did not render');
  return {
    logoRow: logoRow.getBoundingClientRect(),
    strip: strip.getBoundingClientRect(),
  };
}

// The rail's logo row and the article's header strip share one bottom border
// across the viewport. The strip used to wrap its `h-13` row in a bordered
// parent, so it stood 53px tall beside the rail's 52px and the line stepped
// down a pixel at the rail's edge — visible as soon as the strip carried
// page actions. Each case asserts the rendered geometry, not the classes.
describe('DocsLayout bars', () => {
  it.each<[string, ReactNode]>([
    ['without actions', undefined],
    [
      'with the page actions',
      <PageActions
        key="actions"
        markdownUrl="https://docs.tale.dev/self-hosted/install/quickstart.md"
        markdown="# Quickstart"
      />,
    ],
    [
      'with default-height controls',
      <>
        <Button key="edit">Edit</Button>
        <Button key="more" size="icon" icon={Settings} aria-label="Settings" />
      </>,
    ],
  ])('keeps the header strip on the logo row line %s', (_, actions) => {
    renderPage(actions);
    const { logoRow, strip } = bars();
    expect(logoRow.height).toBe(52);
    expect(strip.height).toBe(logoRow.height);
    expect(strip.bottom).toBe(logoRow.bottom);
  });
});
