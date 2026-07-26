// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

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
let assetsData:
  | { assets: { path: string; size: number }[]; skillMdBytes: number }
  | null
  | undefined = { assets: [], skillMdBytes: 10 };
let assetData:
  | { ok: true; contentBase64: string }
  | { ok: false; error: 'not_found' | 'too_large' }
  | null
  | undefined;
vi.mock('../hooks/queries', () => ({
  useSkill: () => ({
    data: skillData,
    isPending: false,
    isError: false,
  }),
  useSkillAssets: () => ({
    data: assetsData,
    isPending: false,
    isError: false,
  }),
  useSkillAsset: () => ({
    data: assetData,
    isPending: false,
    isError: false,
  }),
}));

const deleteSkill = vi.fn().mockResolvedValue(true);
vi.mock('../hooks/mutations', () => ({
  useDeleteSkill: () => ({ mutateAsync: deleteSkill, isPending: false }),
}));

import { SkillEditor } from './skill-editor';

function renderEditor() {
  return render(
    <SkillEditor
      organizationId="org-1"
      slug="docx"
      onBack={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
}

describe('SkillEditor', () => {
  it('renders the document read-only: metadata facts plus the rendered body', () => {
    skillData = {
      slug: 'docx',
      description: 'Word documents.',
      visibility: 'org',
      body: '# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |',
      labels: ['documents'],
      canEdit: true,
    };
    renderEditor();

    const meta = screen.getByTestId('skill-document-meta');
    expect(meta).toHaveTextContent('Word documents.');
    expect(meta).toHaveTextContent('settings.skills.visibility.org');
    expect(meta).toHaveTextContent('documents');

    const body = screen.getByTestId('skill-document-body');
    expect(body.querySelector('h1')).toHaveTextContent('Title');
    expect(body.querySelector('table')).not.toBeNull();

    // Browse-only: no form controls, no save surface.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('hides Delete from a viewer who may not manage the skill', () => {
    skillData = {
      slug: 'docx',
      description: 'Word documents.',
      visibility: 'org',
      body: 'Body.',
      canEdit: false,
    };
    renderEditor();

    expect(
      screen.queryByRole('button', { name: /common.actions.delete/ }),
    ).not.toBeInTheDocument();
  });

  it('shows not-found for a missing slug', () => {
    skillData = null;
    renderEditor();

    expect(screen.getByText('settings.skills.notFound')).toBeInTheDocument();
  });

  it('swaps between the rendered document and the asset viewer via the tree', async () => {
    skillData = {
      slug: 'docx',
      description: 'Word documents.',
      visibility: 'org',
      body: '# Top',
      canEdit: true,
    };
    assetsData = {
      assets: [{ path: 'scripts/pack.py', size: 5 }],
      skillMdBytes: 20,
    };
    assetData = {
      ok: true,
      contentBase64: Buffer.from('print("hi")').toString('base64'),
    };
    const { user } = renderEditor();

    await user.click(screen.getByRole('treeitem', { name: /pack\.py/ }));
    expect(screen.queryByTestId('skill-document-body')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(document.body.textContent).toContain('print("hi")');
    });

    await user.click(screen.getByRole('treeitem', { name: /SKILL\.md/ }));
    expect(
      screen.getByTestId('skill-document-body').querySelector('h1'),
    ).toHaveTextContent('Top');
  });
});
