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
});
