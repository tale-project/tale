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
});
