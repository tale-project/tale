import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, waitFor } from '@/tests/utils/render';

import { SettingsRail } from './settings-rail';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: {
        to: string;
        children: React.ReactNode;
        className?: string;
        'aria-current'?: string;
        'aria-expanded'?: boolean;
      },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a
        ref={ref}
        href={props.to}
        className={props.className}
        aria-current={props['aria-current'] as never}
        aria-expanded={props['aria-expanded']}
      >
        {props.children}
      </a>
    ),
  ),
  useRouterState: () => '/dashboard/org-1/settings/governance/policies-limits',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

describe('SettingsRail', () => {
  describe('accessibility', () => {
    it('passes axe audit with all sections (governance expanded)', async () => {
      const { container } = render(<SettingsRail organizationId="org-1" />);
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit without account row', async () => {
      const { container } = render(
        <SettingsRail organizationId="org-1" showAccountTab={false} />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
