// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

/**
 * The Websites page says when chat cannot search what the crawl stores.
 * The failure it names: a site read Active with every page indexed while
 * the assistant answered that web-page search "is not set up" — the
 * organization had no embedding model, and nothing on the page said so.
 */

const state = vi.hoisted(() => ({
  ready: undefined as boolean | undefined,
  canReadSettings: true,
  abilityLoading: false,
  shellNudge: 'hidden' as 'shown' | 'hidden' | 'unknown',
  shellNudgeReads: 0,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  createLink: () => () => null,
}));

vi.mock('@tale/ui/button', () => ({
  LinkButton: ({
    children,
    href,
    params,
  }: {
    children: React.ReactNode;
    href: string;
    params: { id: string };
  }) => <a href={href.replace('$id', params.id)}>{children}</a>,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canReadSettings }),
  useAbilityLoading: () => state.abilityLoading,
}));

vi.mock('../hooks/queries', () => ({
  useWebsiteSearchReadiness: () => ({
    data: state.ready === undefined ? undefined : { ready: state.ready },
  }),
}));

vi.mock(
  '@/app/features/settings/data-residency/components/embedding-setup-banner',
  () => ({
    useEmbeddingSetupNudge: () => {
      state.shellNudgeReads += 1;
      return state.shellNudge;
    },
  }),
);

import { WebsiteSearchNotice } from './website-search-notice';

const TITLE = "Chat can't search these websites yet";

beforeEach(() => {
  state.ready = false;
  state.canReadSettings = true;
  state.abilityLoading = false;
  state.shellNudge = 'hidden';
  state.shellNudgeReads = 0;
});

describe('WebsiteSearchNotice', () => {
  it('names the missing embedding model and links an admin to the setting', () => {
    render(<WebsiteSearchNotice organizationId="org-1" />);

    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument();
    expect(
      screen.getByText(/knowledge search needs a working embedding model/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Configure embedding model' }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/data-residency');
  });

  it('points a member who cannot open the settings at an admin, without reading them', () => {
    state.canReadSettings = false;
    render(<WebsiteSearchNotice organizationId="org-1" />);

    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument();
    expect(
      screen.getByText(/Ask an organization admin to set one up/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // The settings reads are admin doors: a member must not mount them.
    expect(state.shellNudgeReads).toBe(0);
  });

  it.each([
    ['search is ready', { ready: true }],
    ['the read has not answered', { ready: undefined }],
    ['the ability is still loading', { abilityLoading: true }],
    ['the dashboard banner already says it', { shellNudge: 'shown' as const }],
    [
      'the dashboard banner is not known yet',
      { shellNudge: 'unknown' as const },
    ],
  ])('says nothing while %s', (_label, override) => {
    Object.assign(state, override);
    const { container } = render(
      <WebsiteSearchNotice organizationId="org-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is a static banner, not a live announcement, and passes axe', async () => {
    const { container } = render(
      <WebsiteSearchNotice organizationId="org-1" />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await checkAccessibility(container);
  });
});
