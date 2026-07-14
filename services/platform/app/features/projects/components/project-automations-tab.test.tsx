import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { ProjectAutomationsTab } from './project-automations-tab';

type AutomationFixture = {
  automationSlug: string;
  automationName: string;
  status: 'active' | 'broken';
};

let automationsFixture: AutomationFixture[] = [];
let isLoadingFixture = false;

vi.mock('@/app/features/automations/hooks/use-install-state', () => ({
  useProjectAutomations: () => ({
    automations: automationsFixture,
    isLoading: isLoadingFixture,
  }),
}));

// `<Link>` needs a RouterProvider; stub it and keep `to`/`params` as a
// readable href so the list's navigation contract stays assertable.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    className?: string;
  }) => {
    let href = typeof to === 'string' ? to : '#';
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value);
      }
    }
    if (search?.tab) {
      href += `?tab=${search.tab}`;
    }
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

const ORG = 'org_test';
const PROJECT = 'jd7project000000000000000' as Id<'projects'>;

describe('ProjectAutomationsTab', () => {
  beforeEach(() => {
    automationsFixture = [];
    isLoadingFixture = false;
  });

  it('shows the empty state with a hub CTA when nothing is bound', () => {
    render(<ProjectAutomationsTab organizationId={ORG} projectId={PROJECT} />);

    expect(
      screen.getByText('No automations on this project'),
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', {
      name: 'Browse Automations',
    });
    expect(cta).toHaveAttribute(
      'href',
      `/dashboard/${ORG}/automations?tab=all`,
    );
  });

  it('links each bound automation to its project-nested admin page (views live on the project strip)', () => {
    automationsFixture = [
      {
        automationSlug: 'resolve-github-issues',
        automationName: 'Resolve GitHub issues',
        status: 'active',
      },
      {
        automationSlug: 'review-github-pr',
        automationName: 'Review GitHub pull requests',
        status: 'broken',
      },
    ];

    render(<ProjectAutomationsTab organizationId={ORG} projectId={PROJECT} />);

    const resolve = screen.getByRole('link', {
      name: /Resolve GitHub issues/,
    });
    // Management list rows never deep-link a view — the operator surface is
    // the project's own view tab now.
    expect(resolve).toHaveAttribute(
      'href',
      `/dashboard/${ORG}/projects/${PROJECT}/automations/resolve-github-issues`,
    );

    expect(screen.getByText('Needs repair')).toBeInTheDocument();
    const review = screen.getByRole('link', {
      name: /Review GitHub pull requests/,
    });
    expect(review).toHaveAttribute(
      'href',
      `/dashboard/${ORG}/projects/${PROJECT}/automations/review-github-pr`,
    );
  });
});
