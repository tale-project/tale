/**
 * The skill dialog's bundle tree, driven with real key presses: which
 * folders it remembers as collapsed across a reopen (#3755), and that Tab
 * always finds it — collapsing the folder around the selected file must not
 * leave the tree without a Tab stop (#3756).
 */

import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SkillBundleTreePanel } from './skill-bundle-tree-panel';

const ASSETS = [
  { path: 'references/notes.txt', size: 46 },
  { path: 'references/nested/inner.txt', size: 18 },
  { path: 'scripts/run.py', size: 15 },
];

function Tree({
  organizationId = 'org_1',
  slug = 'demo',
  assets = ASSETS,
  initialPath = 'SKILL.md',
}: {
  organizationId?: string;
  slug?: string;
  assets?: ReadonlyArray<{ path: string; size: number }>;
  initialPath?: string;
}) {
  const [selected, setSelected] = useState(initialPath);
  return (
    <>
      <button type="button">Before</button>
      <SkillBundleTreePanel
        organizationId={organizationId}
        assets={assets}
        slug={slug}
        selectedPath={selected}
        onSelectPath={setSelected}
        fileCount={assets.length + 1}
      />
      <button type="button">After</button>
    </>
  );
}

const row = (name: string) => screen.getByRole('treeitem', { name });
const folder = (name: string) => row(`${name}/`);
const tabStops = () =>
  screen
    .getAllByRole('treeitem')
    .filter((item) => item.tabIndex === 0)
    .map((item) => item.getAttribute('aria-label'));

beforeEach(() => {
  localStorage.clear();
});

describe('SkillBundleTreePanel remembered folders (#3755)', () => {
  it('opens every folder when this browser remembers none', () => {
    render(<Tree />);

    expect(folder('references')).toHaveAttribute('aria-expanded', 'true');
    expect(folder('nested')).toHaveAttribute('aria-expanded', 'true');
    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a folder collapsed when the skill is opened again', async () => {
    const { user, unmount } = render(<Tree />);
    await user.click(folder('references'));
    expect(folder('references')).toHaveAttribute('aria-expanded', 'false');
    unmount();

    render(<Tree />);

    expect(folder('references')).toHaveAttribute('aria-expanded', 'false');
    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.queryByRole('treeitem', { name: 'references/notes.txt' }),
    ).not.toBeInTheDocument();
  });

  it('remembers a collapsed folder inside an open one, and a reopened one', async () => {
    const { user, unmount } = render(<Tree />);
    await user.click(folder('nested'));
    await user.click(folder('scripts'));
    await user.click(folder('scripts'));
    unmount();

    render(<Tree />);

    expect(folder('references')).toHaveAttribute('aria-expanded', 'true');
    expect(folder('nested')).toHaveAttribute('aria-expanded', 'false');
    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens a folder the bundle gained since, and keeps the collapsed ones', async () => {
    const { user, unmount } = render(<Tree />);
    await user.click(folder('scripts'));
    unmount();

    render(
      <Tree assets={[...ASSETS, { path: 'assets/logo.svg', size: 120 }]} />,
    );

    expect(folder('assets')).toHaveAttribute('aria-expanded', 'true');
    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'false');
    expect(folder('references')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a collapsed folder collapsed while a refetch adds another', async () => {
    const { user, rerender } = render(<Tree />);
    await user.click(folder('references'));

    rerender(
      <Tree assets={[...ASSETS, { path: 'assets/logo.svg', size: 120 }]} />,
    );

    expect(folder('references')).toHaveAttribute('aria-expanded', 'false');
    expect(folder('assets')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps each skill’s folders apart', async () => {
    const { user, unmount } = render(<Tree slug="alpha" />);
    await user.click(folder('references'));
    unmount();

    render(<Tree slug="beta" />);

    expect(folder('references')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps each organization’s folders apart for the same slug', async () => {
    const { user, unmount } = render(<Tree organizationId="org_a" />);
    await user.click(folder('scripts'));
    unmount();

    const { unmount: unmountB } = render(<Tree organizationId="org_b" />);
    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'true');
    unmountB();

    render(<Tree organizationId="org_a" />);
    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'false');
  });

  it('drops the earlier record of open folders instead of guessing from it', () => {
    // It listed the OPEN folders per slug: `scripts` missing from it could
    // have been collapsed, or added since.
    localStorage.setItem(
      'skill-bundle-tree-expanded:demo',
      JSON.stringify(['references', 'references/nested']),
    );

    render(<Tree />);

    expect(folder('scripts')).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('skill-bundle-tree-expanded:demo')).toBeNull();
  });

  it('reads a malformed record as nothing remembered', () => {
    localStorage.setItem(
      'skill-bundle-tree-collapsed:org_1:demo',
      JSON.stringify({ references: true }),
    );

    render(<Tree />);

    expect(folder('references')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('SkillBundleTreePanel keyboard entry point (#3756)', () => {
  it('keeps the Tab stop on the folder that hides the selected file', async () => {
    const { user } = render(<Tree />);
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(row('SKILL.md')).toHaveFocus();

    // ArrowDown to the asset under references/, Enter to select it.
    const notes = row('references/notes.txt');
    for (let i = 0; i < 6 && document.activeElement !== notes; i++) {
      await user.keyboard('{ArrowDown}');
    }
    await user.keyboard('{Enter}');
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(tabStops()).toEqual(['references/notes.txt']);

    // ArrowLeft to its folder, ArrowLeft again to collapse it.
    await user.keyboard('{ArrowLeft}');
    expect(folder('references')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(folder('references')).toHaveAttribute('aria-expanded', 'false');
    expect(tabStops()).toEqual(['references/']);

    // Tab out and back.
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(folder('references')).toHaveFocus();

    // The keyboard still reaches another file from there.
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Enter}');
    expect(row('SKILL.md')).toHaveAttribute('aria-selected', 'true');
    expect(tabStops()).toEqual(['SKILL.md']);
  });

  it('gives the stop back to the selected file once its folder opens', async () => {
    const { user } = render(<Tree initialPath="references/notes.txt" />);
    await user.click(folder('references'));
    expect(tabStops()).toEqual(['references/']);

    await user.click(folder('references'));

    expect(tabStops()).toEqual(['references/notes.txt']);
  });

  it('puts the stop on the outermost collapsed folder above the selection', async () => {
    const { user } = render(<Tree initialPath="references/nested/inner.txt" />);
    await user.click(folder('nested'));
    expect(tabStops()).toEqual(['nested/']);

    await user.click(folder('references'));

    expect(tabStops()).toEqual(['references/']);
  });

  it('keeps a stop when the selected file has left the bundle', () => {
    const { rerender } = render(<Tree initialPath="scripts/run.py" />);

    rerender(
      <Tree
        initialPath="scripts/run.py"
        assets={ASSETS.filter((asset) => asset.path !== 'scripts/run.py')}
      />,
    );

    expect(tabStops()).toEqual(['SKILL.md']);
  });

  it('keeps exactly one stop through every selection and folder change', async () => {
    const { user } = render(<Tree />);
    expect(tabStops()).toEqual(['SKILL.md']);

    await user.click(row('references/nested/inner.txt'));
    expect(tabStops()).toEqual(['references/nested/inner.txt']);
    await user.click(folder('references'));
    expect(tabStops()).toEqual(['references/']);
    await user.click(folder('scripts'));
    expect(tabStops()).toEqual(['references/']);
    await user.click(folder('references'));
    expect(tabStops()).toEqual(['references/nested/inner.txt']);
    await user.click(row('SKILL.md'));
    expect(tabStops()).toEqual(['SKILL.md']);
  });
});
