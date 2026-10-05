// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

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
      { _id: 'proj_3', name: 'Field service' },
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

/** The selected projects, in chip order — each chip carries a remove button. */
const selectedProjects = () =>
  screen
    .queryAllByRole('button', { name: /^Remove / })
    .map((button) =>
      button.getAttribute('aria-label')?.replace(/^Remove /, ''),
    );

/** An author's section, rendered again as each query answer arrives. */
function section() {
  return (
    <GeneralTab>
      <ProjectBindingsSection
        organizationId="org-1"
        name="desk/prepare-return"
        canEdit
      />
    </GeneralTab>
  );
}

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
    const { user, rerender } = render(section());

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    // A new array with the same content, as a refetch hands it back.
    boundData = ['proj_1'];
    rerender(section());

    expect(saveButton()).toBeEnabled();
  });

  // A set another session saved reaches a selection holding an edit (#3620):
  // the author's unsaved adds and removes are replayed onto it.
  it('keeps an unsaved project when another session changes the bound set', async () => {
    boundData = ['proj_1'];
    setProjects.mutateAsync.mockResolvedValue(undefined);
    const { user, rerender } = render(section());

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    boundData = ['proj_1', 'proj_3'];
    rerender(section());

    expect(selectedProjects()).toEqual([
      'Document desk',
      'Field service',
      'Getting started',
    ]);
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    expect(setProjects.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectIds: ['proj_1', 'proj_3', 'proj_2'] }),
    );
  });

  it('keeps an unsaved removal when another session adds a project', async () => {
    boundData = ['proj_1', 'proj_2'];
    const { user, rerender } = render(section());

    await user.click(
      screen.getByRole('button', { name: 'Remove Document desk' }),
    );
    boundData = ['proj_1', 'proj_2', 'proj_3'];
    rerender(section());

    expect(selectedProjects()).toEqual(['Getting started', 'Field service']);
    expect(saveButton()).toBeEnabled();
  });

  it('settles on the set its own save wrote', async () => {
    boundData = ['proj_1'];
    setProjects.mutateAsync.mockResolvedValue(undefined);
    const { user, rerender } = render(section());

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    await user.click(saveButton());
    // The store answers with the saved set, in its own order.
    boundData = ['proj_2', 'proj_1'];
    rerender(section());

    expect(selectedProjects()).toEqual(['Getting started', 'Document desk']);
    // Nothing is left to save (Save reads "Saved" for a moment).
    expect(
      screen.getByRole('button', { name: 'common.actions.discard' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /^common\.actions\.saved?$/ }),
    ).toBeDisabled();
  });

  /** Pick Getting started and press Save, whose answer waits for `answer`. */
  async function addAndSaveDeferred(
    user: ReturnType<typeof render>['user'],
  ): Promise<() => void> {
    let answer: () => void = () => {};
    setProjects.mutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Getting started/ }));
    await user.keyboard('{Escape}');
    await user.click(saveButton());
    await waitFor(() =>
      expect(setProjects.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectIds: ['proj_1', 'proj_2'] }),
      ),
    );
    return () => answer();
  }

  // The picker stays editable while a save is out (#4321 review B2): a
  // project dropped after Save stays dropped, whichever of the save's set
  // and its answer comes first.
  it.each([
    ['before the save answers', true],
    ['after the save answers', false],
  ])(
    'keeps a project dropped during the save when its set lands %s',
    async (_when, setFirst) => {
      boundData = ['proj_1'];
      const { user, rerender } = render(section());
      const answer = await addAndSaveDeferred(user);
      await user.click(
        screen.getByRole('button', { name: 'Remove Getting started' }),
      );
      if (setFirst) {
        boundData = ['proj_1', 'proj_2'];
        rerender(section());
      }
      await act(async () => {
        answer();
      });
      if (!setFirst) {
        boundData = ['proj_1', 'proj_2'];
        rerender(section());
      }

      expect(selectedProjects()).toEqual(['Document desk']);
      expect(
        screen.getByRole('button', { name: 'common.actions.discard' }),
      ).toBeEnabled();
    },
  );

  it('settles on its own save when another session’s set lands first', async () => {
    boundData = ['proj_1'];
    const { user, rerender } = render(section());
    const answer = await addAndSaveDeferred(user);
    // Another session unbinds Document desk; then this save, written after
    // it, lands with both projects bound.
    boundData = [];
    rerender(section());
    boundData = ['proj_1', 'proj_2'];
    rerender(section());
    await act(async () => {
      answer();
    });

    expect(selectedProjects()).toEqual(['Document desk', 'Getting started']);
    expect(
      screen.getByRole('button', { name: 'common.actions.discard' }),
    ).toBeDisabled();
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
