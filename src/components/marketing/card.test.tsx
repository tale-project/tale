import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  MarketingRouterProvider,
  type MarketingLinkComponentProps,
} from '../../routing';
import { MarketingCard } from './card';

function TestLink({
  to,
  activeProps: _activeProps,
  children,
  ...props
}: MarketingLinkComponentProps) {
  return (
    <a href={to} {...props}>
      {children}
    </a>
  );
}

function Cards({ children }: { children: ReactNode }) {
  return (
    <MarketingRouterProvider link={TestLink}>
      {children}
    </MarketingRouterProvider>
  );
}

describe('MarketingCard', () => {
  it.each(['plain', 'raised', 'inset', 'featured', 'quiet'] as const)(
    'keeps a %s destination one labelled link through the host router',
    (surface) => {
      render(
        <Cards>
          <MarketingCard
            surface={surface}
            title="Build a project"
            description="Start with a useful task."
            to="/guides/project"
            reveal={false}
          >
            <span>Read the guide</span>
          </MarketingCard>
        </Cards>,
      );
      const link = screen.getByRole('link', { name: /Build a project/ });
      expect(link).toHaveAttribute('href', '/guides/project');
      expect(link).toHaveTextContent('Start with a useful task.');
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(link.querySelector('a, button')).toBeNull();
    },
  );

  it('keeps a static featured card outside keyboard navigation', () => {
    render(
      <Cards>
        <MarketingCard
          surface="featured"
          title="One shared workspace"
          reveal={false}
        />
      </Cards>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(
      screen.getByText('One shared workspace').closest('[tabindex]'),
    ).toBeNull();
  });

  it('supports semantic headings and paragraphs without nesting them in phrasing-only elements', () => {
    render(
      <Cards>
        <MarketingCard
          title={<h3>Project guides</h3>}
          description={<p>Follow a task from brief to review.</p>}
          to="/guides/project"
          reveal={false}
        />
      </Cards>,
    );
    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'Project guides',
    });
    expect(heading.closest('span, p')).toBeNull();
    expect(
      screen
        .getByText('Follow a task from brief to review.')
        .parentElement?.closest('span, p'),
    ).toBeNull();
    expect(screen.getByRole('link')).toContainElement(heading);
  });
});
