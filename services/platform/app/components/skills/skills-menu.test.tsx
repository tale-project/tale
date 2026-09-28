import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SkillsMenu } from './skills-menu';

const EMPTY = { skills: [], connectors: [], tools: [] } as const;

describe('SkillsMenu', () => {
  it('renders a host label through the form Label, not a caption', () => {
    render(
      <SkillsMenu
        skills={[]}
        connectors={[]}
        tools={[]}
        value={EMPTY}
        onChange={vi.fn()}
        label="Equipment"
      />,
    );

    const fieldLabel = screen.getByText('Equipment');
    expect(fieldLabel.tagName).toBe('LABEL');
    expect(
      screen.getByRole('group', { name: 'Equipment' }),
    ).toBeInTheDocument();
  });

  it('lists an equipped skill the picker cannot see as a checked, removable entry', async () => {
    // A skill unshared from the scope after it was equipped still counts
    // and still fails a run; hidden, it read "Skills (1)" with nothing to
    // untick (2026-09-26 evaluation, C-09).
    const onChange = vi.fn();
    const { user } = render(
      <SkillsMenu
        skills={[{ slug: 'docx', label: 'Word documents' }]}
        connectors={[]}
        tools={[]}
        value={{ skills: ['docx', 'gone-skill'], connectors: [], tools: [] }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skills/i }));
    const stale = await screen.findByRole('menuitemcheckbox', {
      name: '"gone-skill" (unavailable)',
    });
    expect(stale).toHaveAttribute('aria-checked', 'true');

    await user.click(stale);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ skills: ['docx'] }),
    );
  });

  it('names who created each skill under its row', async () => {
    const { user } = render(
      <SkillsMenu
        skills={[
          {
            slug: 'house-voice',
            label: 'house-voice',
            origin: 'member',
            ownerName: 'Ada Lovelace',
          },
          { slug: 'orphan', label: 'orphan', origin: 'member' },
          { slug: 'docx', label: 'docx', origin: 'builtin' },
          { slug: 'invoices', label: 'invoices', origin: 'release' },
        ]}
        connectors={[]}
        tools={[]}
        value={EMPTY}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skills/i }));

    const row = (name: string) =>
      screen.findByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) });
    expect(await row('house-voice')).toHaveTextContent('By Ada Lovelace');
    expect(await row('orphan')).toHaveTextContent('By a former member');
    expect(await row('docx')).toHaveTextContent('Built-in');
    expect(await row('invoices')).toHaveTextContent('Configuration release');
  });

  it('adds no caption to an option that carries no provenance', async () => {
    const { user } = render(
      <SkillsMenu
        skills={[]}
        connectors={[{ slug: 'github', label: 'GitHub' }]}
        tools={[]}
        value={EMPTY}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skills/i }));
    expect(
      await screen.findByRole('menuitemcheckbox', { name: /GitHub/ }),
    ).toHaveTextContent(/^GitHub$/);
  });
});
