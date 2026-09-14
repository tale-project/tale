import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TabNavigation, type TabNavigationItem } from './tab-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: { to: string; children: React.ReactNode; className?: string },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard/test-org/settings' }),
  useSearch: () => ({}),
}));

vi.mock('@tale/ui/use-resize-observer', () => ({
  useResizeObserver: vi.fn(),
}));

const abilityState = { allowed: true };
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => abilityState.allowed,
    cannot: () => !abilityState.allowed,
  }),
}));

const items: TabNavigationItem[] = [
  { label: 'General', href: '/dashboard/test-org/settings' },
  {
    label: 'Organization',
    href: '/dashboard/test-org/settings/organization',
    can: ['read', 'orgSettings'],
  },
];

describe('TabNavigation (platform)', () => {
  it('shows a permission-gated tab when the ability allows it', () => {
    abilityState.allowed = true;
    render(<TabNavigation ariaLabel="Settings" items={[...items]} />);
    expect(screen.getByText('Organization')).toBeInTheDocument();
  });

  it('drops a permission-gated tab when the ability denies it', () => {
    abilityState.allowed = false;
    render(<TabNavigation ariaLabel="Settings" items={[...items]} />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.queryByText('Organization')).not.toBeInTheDocument();
  });
});
