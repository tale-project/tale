import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { VersionList } from './version-list';

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}

// Rows are router links to the Editor tab; render them as anchors whose
// href spells out the resolved path and search so the tests can read it.
vi.mock('@tanstack/react-router', () => ({
  Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params, search, children, ...rest },
    ref,
  ) {
    const path = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to ?? '',
    );
    const query = new URLSearchParams(
      Object.entries(search ?? {}).map(([key, value]) => [key, String(value)]),
    ).toString();
    return (
      <a ref={ref} href={query ? `${path}?${query}` : path} {...rest}>
        {children}
      </a>
    );
  }),
}));

const versions = [
  {
    version: 1,
    message: 'first cut',
    testsPassed: true,
    createdBy: 'user:a',
    createdAt: 1_700_000_000_000,
  },
  {
    version: 2,
    message: 'add the digest step',
    testsPassed: false,
    createdBy: 'user:a',
    createdAt: 1_700_000_100_000,
  },
];

function renderList({
  deployedVersion = 1,
  projectId,
}: { deployedVersion?: number | undefined; projectId?: string } = {}) {
  return render(
    <>
      <h2 id="versions-heading">Versions</h2>
      <VersionList
        organizationId="org-1"
        automationSlug="billing/dunning"
        {...(projectId !== undefined && { projectId })}
        versions={versions}
        deployedVersion={deployedVersion}
        headingId="versions-heading"
      />
    </>,
  );
}

describe('VersionList', () => {
  it('marks the version that is live and does not offer deploy on the row', () => {
    renderList();
    expect(screen.getByText('Live')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Deploy/ }),
    ).not.toBeInTheDocument();
  });

  it('says which versions were saved with failing tests', () => {
    renderList();
    expect(screen.getByText('Tests failed')).toBeVisible();
    expect(screen.getByText('Tests passed')).toBeVisible();
  });

  it('shows the version messages so the history reads', () => {
    renderList();
    expect(screen.getByText('add the digest step')).toBeVisible();
    expect(screen.getByText('first cut')).toBeVisible();
  });

  it('opens the Editor at that version from a row, newest first', () => {
    renderList();
    const rows = screen.getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/dashboard/org-1/automations/billing__dunning/editor?version=2',
      '/dashboard/org-1/automations/billing__dunning/editor?version=1',
    ]);
  });

  it('keeps the editor links inside the project shell when scoped', () => {
    renderList({ projectId: 'proj-1' });
    expect(screen.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-1/automations/billing__dunning/editor?version=2',
    );
  });

  it('names the list by the tab heading', () => {
    renderList();
    expect(screen.getByRole('list', { name: 'Versions' })).toBeVisible();
  });

  it('says so when nothing has been saved yet', () => {
    render(
      <VersionList
        organizationId="org-1"
        automationSlug="billing/dunning"
        versions={[]}
        deployedVersion={undefined}
        headingId="versions-heading"
      />,
    );
    expect(screen.getByText('No versions saved yet.')).toBeVisible();
  });

  it('is one bordered list with row dividers, not a stack of cards', () => {
    const { container } = renderList();
    const list = container.querySelector('ul');
    expect(list).toHaveClass('divide-y');
    expect(container.querySelectorAll('li.border, li.rounded-md')).toHaveLength(
      0,
    );
  });

  it('passes an axe audit', async () => {
    const { container } = renderList();
    await checkAccessibility(container);
  });
});
