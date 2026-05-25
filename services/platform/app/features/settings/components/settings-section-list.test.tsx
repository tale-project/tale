import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import {
  SettingsSectionList,
  type SettingsSectionListGroup,
} from './settings-section-list';

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
}));

function buildGroups(): SettingsSectionListGroup[] {
  return [
    {
      key: 'you',
      label: 'You',
      items: [
        {
          key: 'account',
          label: 'Account',
          description: 'Your account preferences',
          href: '/settings/account',
        },
        {
          key: 'personalization',
          label: 'Personalization',
          href: '/settings/personalization',
        },
      ],
    },
    {
      key: 'workspace',
      label: 'Workspace',
      items: [
        {
          key: 'organization',
          label: 'Organization',
          href: '/settings/organization',
        },
      ],
    },
  ];
}

describe('SettingsSectionList', () => {
  describe('rendering', () => {
    it('renders one link per item', () => {
      render(<SettingsSectionList groups={buildGroups()} />);
      expect(screen.getAllByRole('link')).toHaveLength(3);
    });

    it('renders each item label as a navigable link', () => {
      render(<SettingsSectionList groups={buildGroups()} />);
      expect(screen.getByRole('link', { name: /account/i })).toHaveAttribute(
        'href',
        '/settings/account',
      );
      expect(
        screen.getByRole('link', { name: /organization/i }),
      ).toHaveAttribute('href', '/settings/organization');
    });

    it('renders group labels', () => {
      render(<SettingsSectionList groups={buildGroups()} />);
      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('Workspace')).toBeInTheDocument();
    });

    it('renders item descriptions', () => {
      render(<SettingsSectionList groups={buildGroups()} />);
      expect(screen.getByText('Your account preferences')).toBeInTheDocument();
    });

    it('uses role="list" on the inner list elements', () => {
      const { container } = render(
        <SettingsSectionList groups={buildGroups()} />,
      );
      const lists = container.querySelectorAll('ul[role="list"]');
      expect(lists).toHaveLength(2);
    });

    it('sets aria-label on the nav element', () => {
      render(
        <SettingsSectionList
          groups={buildGroups()}
          ariaLabel="User settings"
        />,
      );
      expect(
        screen.getByRole('navigation', { name: 'User settings' }),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SettingsSectionList
          groups={buildGroups()}
          ariaLabel="User settings"
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
