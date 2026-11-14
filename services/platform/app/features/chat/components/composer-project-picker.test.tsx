/**
 * The composer's project glyph sits beside its ghost toolbar icons: it takes
 * their 16 px size and colour, and the no-project folder icon matches it, so
 * choosing a project does not make the toolbar jump.
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ChatProjectSummary } from '../types';
import { ComposerProjectPicker } from './composer-project-picker';

const PROJECTS: ChatProjectSummary[] = [
  { id: 'p1', name: 'Launch site', icon: 'Rocket', color: 'blue' },
];

describe('composer project glyph', () => {
  it('renders the chosen project at the toolbar icon size and colour', () => {
    render(
      <ComposerProjectPicker
        projects={PROJECTS}
        projectId="p1"
        draft={false}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByTestId('composer-project-picker');
    const glyph = trigger.querySelector('svg');
    expect(glyph).toHaveClass('size-4');
    expect(glyph).not.toHaveClass('size-3');
    expect(trigger.querySelector('.text-muted-foreground')).toBeNull();
  });

  it('keeps the no-project folder icon at the same size as the project glyph', () => {
    render(
      <ComposerProjectPicker
        projects={PROJECTS}
        projectId={undefined}
        draft
        onChange={vi.fn()}
      />,
    );
    const glyph = screen
      .getByTestId('composer-project-picker')
      .querySelector('svg');
    expect(glyph).toHaveClass('size-4');
  });
});
