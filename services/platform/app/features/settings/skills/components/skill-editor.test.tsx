// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

let skillData:
  | {
      slug: string;
      description: string;
      visibility: 'private' | 'org';
      body: string;
      labels?: string[];
      icon?: string;
      canEdit: boolean;
    }
  | null
  | undefined;
vi.mock('../hooks/queries', () => ({
  useSkill: () => ({
    data: skillData,
    isPending: false,
    isError: false,
  }),
}));

const saveSkill = vi.fn().mockResolvedValue({});
const deleteSkill = vi.fn().mockResolvedValue(true);
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: saveSkill, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: deleteSkill, isPending: false }),
}));

import { SkillEditor } from './skill-editor';

/** Captures the controller the editor registers with the global save bar. */
function ActiveProbe({
  capture,
}: {
  capture: { current: EditorController | null };
}) {
  capture.current = useActiveEditor();
  return null;
}

function renderEditor() {
  const capture = { current: null as EditorController | null };
  const utils = render(
    <ActiveEditorProvider>
      <ActiveProbe capture={capture} />
      <SkillEditor
        organizationId="org-1"
        slug="visual-aspect-analyzer"
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />
    </ActiveEditorProvider>,
  );
  return { ...utils, capture };
}

describe('SkillEditor', () => {
  it('seeds the form from the loaded document and saves the edited fields through the global controller', async () => {
    skillData = {
      slug: 'visual-aspect-analyzer',
      description: 'Analyze visual aspects.',
      visibility: 'org',
      body: '# Playbook',
      labels: ['vision', 'pdf'],
      canEdit: true,
    };
    const { user, capture } = renderEditor();

    const description = screen.getByLabelText(
      'settings.skills.form.description',
    );
    expect(description).toHaveValue('Analyze visual aspects.');
    expect(screen.getByLabelText('settings.skills.section.body')).toHaveValue(
      '# Playbook',
    );
    expect(screen.getByLabelText('settings.skills.editor.labels')).toHaveValue(
      'vision, pdf',
    );

    await user.clear(description);
    await user.type(description, 'Sharper description.');

    expect(capture.current?.isDirty).toBe(true);
    await act(async () => {
      await capture.current?.save();
    });

    expect(saveSkill).toHaveBeenCalledWith({
      organizationId: 'org-1',
      slug: 'visual-aspect-analyzer',
      description: 'Sharper description.',
      body: '# Playbook',
      visibility: 'org',
      labels: ['vision', 'pdf'],
    });
  });

  it('renders read-only (no delete, no registered editor) when the viewer cannot edit', () => {
    skillData = {
      slug: 'visual-aspect-analyzer',
      description: 'Analyze visual aspects.',
      visibility: 'org',
      body: '',
      canEdit: false,
    };
    const { capture } = renderEditor();

    expect(screen.getByText('settings.skills.readOnly')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /common.actions.delete/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('settings.skills.form.description'),
    ).toBeDisabled();
    // Read-only viewers never get Save/Discard in the settings header.
    expect(capture.current).toBeNull();
  });

  it('shows not-found for a missing slug', () => {
    skillData = null;
    renderEditor();

    expect(screen.getByText('settings.skills.notFound')).toBeInTheDocument();
  });
});
