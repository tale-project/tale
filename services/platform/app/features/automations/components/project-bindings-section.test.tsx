// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The section reads the bound set and the org's projects reactively and saves
// through the reconcile mutation; the tests stub all three seams.
let boundData: string[] | undefined;
const setProjects = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../hooks/queries', () => ({
  useAutomationProjects: () => ({ data: boundData, isPending: false }),
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
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined
        ? `${ns}.${key}`
        : `${ns}.${key}:${JSON.stringify(params)}`,
  }),
}));

import { AutomationEditorActions } from './automation-editor-actions';
import { ProjectBindingsSection } from './project-bindings-section';

/** The General tab's frame: its sections join one Save/Discard cluster. */
function GeneralTab({ children }: { children: ReactNode }) {
  return (
    <ActiveEditorProvider>
      <AutomationEditorActions />
      <EditorGroup>{children}</EditorGroup>
    </ActiveEditorProvider>
  );
}

const saveButton = () =>
  screen.getByRole('button', { name: 'common.actions.save' });

describe('ProjectBindingsSection', () => {
  it('shows the hint and no count for an unbound automation, and waits for an edit', () => {
    boundData = [];
    render(
      <GeneralTab>
        <ProjectBindingsSection
          organizationId="org-1"
          name="org/digest"
          canEdit
        />
      </GeneralTab>,
    );

    expect(screen.getByText('automations.bindings.hint')).toBeInTheDocument();
    expect(
      screen.queryByText(/automations\.bindings\.countBadge/),
    ).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("counts the bound projects and saves the reconciled set from the page's cluster", async () => {
    boundData = ['proj_1'];
    setProjects.mutateAsync.mockResolvedValue(undefined);
    const { user } = render(
      <GeneralTab>
        <ProjectBindingsSection
          organizationId="org-1"
          name="desk/prepare-return"
          canEdit
        />
      </GeneralTab>,
    );

    expect(
      screen.getByText('automations.bindings.countBadge:{"count":1}'),
    ).toBeInTheDocument();

    // Add the second project through the MultiSelect, then save.
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    expect(setProjects.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'desk/prepare-return',
        projectIds: expect.arrayContaining(['proj_1', 'proj_2']),
      }),
    );
  });

  it('keeps a selection in progress when a refetch answers the same set', async () => {
    boundData = ['proj_1'];
    const section = () => (
      <GeneralTab>
        <ProjectBindingsSection
          organizationId="org-1"
          name="desk/prepare-return"
          canEdit
        />
      </GeneralTab>
    );
    const { user, rerender } = render(section());

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    // A new array with the same content, as a refetch hands it back.
    boundData = ['proj_1'];
    rerender(section());

    expect(saveButton()).toBeEnabled();
  });

  it('discards the selection back to the stored set', async () => {
    boundData = ['proj_1'];
    const { user } = render(
      <GeneralTab>
        <ProjectBindingsSection
          organizationId="org-1"
          name="desk/prepare-return"
          canEdit
        />
      </GeneralTab>,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.discard' }),
    );

    expect(saveButton()).toBeDisabled();
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
  });

  it('renders read-only for members: the set is visible, the controls are not', () => {
    boundData = ['proj_1'];
    render(
      <GeneralTab>
        <ProjectBindingsSection
          organizationId="org-1"
          name="desk/prepare-return"
          canEdit={false}
        />
      </GeneralTab>,
    );

    expect(
      screen.getByText('automations.bindings.countBadge:{"count":1}'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'common.actions.save' }),
    ).not.toBeInTheDocument();
  });
});
