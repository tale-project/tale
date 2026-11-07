import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TypeaheadListbox } from './typeahead-listbox';

const DESCRIPTION =
  'Use this skill whenever the user wants to create, read, edit, or manipulate Word documents.';

function renderListbox() {
  return render(
    <TypeaheadListbox
      listboxId="skills"
      optionId={(index) => `skills-option-${index}`}
      label="Skills"
      emptyLabel="No skill matches"
      options={[
        { key: 'docx', name: '/docx', caption: DESCRIPTION },
        { key: 'pdf', name: '/pdf' },
      ]}
      highlight={0}
      onPick={vi.fn()}
      onHighlight={vi.fn()}
    />,
  );
}

describe('TypeaheadListbox', () => {
  it('names an option by its name and describes it by its caption', () => {
    renderListbox();
    const docx = screen.getByRole('option', { name: '/docx' });
    expect(docx).toHaveAccessibleDescription(DESCRIPTION);
    expect(docx).toHaveAttribute('aria-selected', 'true');
    const pdf = screen.getByRole('option', { name: '/pdf' });
    expect(pdf).not.toHaveAttribute('aria-describedby');
  });
});
