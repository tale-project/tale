import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { LogoLink } from './logo-link';

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
  useLocation: () => ({ pathname: '/' }),
  useSearch: () => ({}),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ textLogo: 'Tale', logoUrl: null }),
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => '',
}));

describe('LogoLink', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<LogoLink href="/dashboard" />);
      await checkAccessibility(container);
    });
  });
});
