// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { RefreshCw } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SkillsActionMenu } from './skills-action-menu';

const createSkillMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useCreateSkill: () => ({ mutateAsync: createSkillMock }),
}));

// FormDialog resolves the org for its error boundary via router params; no
// router mounts in this suite.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The template dialog lists the builtin catalog; two fixed rows keep the
// Select assertable without the file-walking action.
vi.mock('../hooks/queries', () => ({
  useListCatalogSkills: () => ({
    templates: [
      { slug: 'browse-web', name: 'browse-web', description: 'Browse.' },
      { slug: 'docx', name: 'docx', description: 'Word docs.' },
    ],
    isLoading: false,
    error: null,
  }),
}));

// The upload dialog wires the storage/zip pipeline — out of scope here; a
// marker proves the menu item opens it.
vi.mock('./skill-upload/skill-upload-dialog', () => ({
  SkillUploadDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="upload-dialog" /> : null,
}));

beforeEach(() => {
  createSkillMock.mockReset();
  createSkillMock.mockResolvedValue({ slug: 'my-skill' });
});

describe('SkillsActionMenu', () => {
  it('offers Blank / From template / Upload plus page-appended items', async () => {
    const syncClick = vi.fn();
    const { user } = render(
      <SkillsActionMenu
        organizationId="org-1"
        extraMenuItems={[
          {
            label: 'Update built-in skills',
            icon: RefreshCw,
            onClick: syncClick,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add skill' }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Blank',
      'From template',
      'Upload skill',
      'Update built-in skills',
    ]);

    await user.click(
      screen.getByRole('menuitem', { name: 'Update built-in skills' }),
    );
    expect(syncClick).toHaveBeenCalledTimes(1);
  });

  it('creates a blank skill from the name and deep-links via onUploaded', async () => {
    const onUploaded = vi.fn();
    const { user } = render(
      <SkillsActionMenu organizationId="org-1" onUploaded={onUploaded} />,
    );

    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.click(screen.getByRole('menuitem', { name: 'Blank' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Create skill',
    });
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'my-skill');
    await user.tab(); // onTouched validation — blur enables Create
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(createSkillMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      slug: 'my-skill',
    });
    expect(onUploaded).toHaveBeenCalledWith('my-skill');
  });

  it('opens the template dialog with the builtin catalog and a name field', async () => {
    const { user } = render(<SkillsActionMenu organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.click(screen.getByRole('menuitem', { name: 'From template' }));

    expect(
      await screen.findByRole('dialog', { name: 'New skill from template' }),
    ).toBeInTheDocument();
    // Submit stays disabled until a template is picked AND the name is valid.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: 'Template' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('opens the upload dialog from the Upload item', async () => {
    const { user } = render(<SkillsActionMenu organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Add skill' }));
    await user.click(screen.getByRole('menuitem', { name: 'Upload skill' }));

    expect(screen.getByTestId('upload-dialog')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe with the menu open', async () => {
      const { container, user } = render(
        <SkillsActionMenu organizationId="org-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Add skill' }));
      await checkAccessibility(container);
    });

    it('passes axe with the create dialog open', async () => {
      const { baseElement, user } = render(
        <SkillsActionMenu organizationId="org-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Add skill' }));
      await user.click(screen.getByRole('menuitem', { name: 'Blank' }));
      await screen.findByRole('dialog', { name: 'Create skill' });
      await checkAccessibility(baseElement);
    });
  });
});
