// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The panel reads the bound set and the org's projects reactively and saves
// through the reconcile mutation; the tests stub all three seams.
let boundData: string[] | undefined;
const setProjects = { mutate: vi.fn(), isPending: false };

vi.mock('../hooks/queries', () => ({
  useAutomationProjects: () => ({ data: boundData }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetAutomationProjects: () => setProjects,
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({
    projects: [
      { _id: 'proj_1', name: 'Document desk' },
      { _id: 'proj_2', name: 'Getting started' },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined
        ? `${ns}.${key}`
        : `${ns}.${key}:${JSON.stringify(params)}`,
  }),
}));

import { ProjectBindingsSection } from './project-bindings-section';

describe('ProjectBindingsSection', () => {
  it('shows no org-wide badge for an unbound automation and disables Save until dirty', () => {
    boundData = [];
    render(
      <ProjectBindingsSection
        organizationId="org-1"
        name="org/digest"
        canEdit
      />,
    );

    expect(
      screen.queryByText('automations.bindings.orgBadge'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('automations.bindings.hint')).toBeInTheDocument();
    // The Button's disabled affordance is aria-disabled (disabledReason
    // tooltip pattern), not the DOM attribute.
    expect(
      screen.getByRole('button', { name: 'automations.bindings.save' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('counts the bound projects and saves the reconciled set', async () => {
    boundData = ['proj_1'];
    const { user } = render(
      <ProjectBindingsSection
        organizationId="org-1"
        name="desk/prepare-return"
        canEdit
      />,
    );

    expect(
      screen.getByText('automations.bindings.countBadge:{"count":1}'),
    ).toBeInTheDocument();

    // Add the second project through the MultiSelect, then save.
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    const save = screen.getByRole('button', {
      name: 'automations.bindings.save',
    });
    expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(save);

    expect(setProjects.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'desk/prepare-return',
        projectIds: expect.arrayContaining(['proj_1', 'proj_2']),
      }),
      expect.anything(),
    );
  });

  it('renders read-only for members: the set is visible, the controls are not', () => {
    boundData = ['proj_1'];
    render(
      <ProjectBindingsSection
        organizationId="org-1"
        name="desk/prepare-return"
        canEdit={false}
      />,
    );

    expect(
      screen.getByText('automations.bindings.countBadge:{"count":1}'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'automations.bindings.save' }),
    ).not.toBeInTheDocument();
  });
});
