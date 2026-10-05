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

  it('lists an equipped connector the picker cannot see as a checked, removable entry', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <SkillsMenu
        skills={[]}
        connectors={[]}
        tools={[]}
        value={{ skills: [], connectors: ['github'], tools: [] }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skills/i }));
    const stale = await screen.findByRole('menuitemcheckbox', {
      name: '"github" (unavailable)',
    });
    expect(stale).toHaveAttribute('aria-checked', 'true');

    await user.click(stale);
    expect(onChange).toHaveBeenCalledWith({
      skills: [],
      connectors: [],
      tools: [],
    });
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
            description: 'A description must not replace creator provenance',
          },
          { slug: 'orphan', label: 'orphan', origin: 'member' },
          { slug: 'docx', label: 'docx', origin: 'builtin' },
          { slug: 'invoices', label: 'invoices', origin: 'release' },
          {
            slug: 'spoofed',
            label: 'spoofed',
            origin: 'release',
            ownerName: 'Mallory',
          },
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
    expect(await row('house-voice')).not.toHaveTextContent(
      'A description must not replace creator provenance',
    );
    expect(await row('orphan')).toHaveTextContent('By a former member');
    expect(await row('docx')).toHaveTextContent('Built-in');
    expect(await row('invoices')).toHaveTextContent('Configuration release');
    // The release marker is plain frontmatter any upload can carry, so the
    // caption names whose upload installed the skill.
    expect(await row('spoofed')).toHaveTextContent(
      'Configuration release · Mallory',
    );
  });

  it('shows the supplied read/write descriptions and keeps tool selection unchanged', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <SkillsMenu
        skills={[]}
        connectors={[]}
        tools={[
          { slug: 'task_find', label: 'Find tasks', description: 'Read only' },
          {
            slug: 'task_update_metadata',
            label: 'Change task priority and agent assignment',
            description: 'Writes data',
          },
        ]}
        value={EMPTY}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skills/i }));
    expect(
      await screen.findByRole('menuitemcheckbox', { name: /^Find tasks/ }),
    ).toHaveTextContent('Read only');
    const write = await screen.findByRole('menuitemcheckbox', {
      name: /^Change task priority and agent assignment/,
    });
    expect(write).toHaveTextContent('Writes data');
    await user.click(write);
    expect(onChange).toHaveBeenCalledWith({
      skills: [],
      connectors: [],
      tools: ['task_update_metadata'],
    });
  });

  it('adds no caption when neither provenance nor description is supplied', async () => {
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
