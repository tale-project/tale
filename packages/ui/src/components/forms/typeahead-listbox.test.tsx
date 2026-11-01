import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TypeaheadListbox } from './typeahead-listbox';

const DESCRIPTION =
  'Use this skill whenever the user wants to create, read, edit, or manipulate Word documents.';

const SKILLS = [
  { key: 'docx', name: '/docx', caption: DESCRIPTION },
  { key: 'pdf', name: '/pdf' },
];

function renderListbox(props: { options?: typeof SKILLS; note?: string } = {}) {
  return render(
    <TypeaheadListbox
      listboxId="skills"
      optionId={(index) => `skills-option-${index}`}
      label="Skills"
      emptyLabel="No skill matches"
      options={props.options ?? SKILLS}
      highlight={0}
      onPick={vi.fn()}
      onHighlight={vi.fn()}
      {...(props.note === undefined ? {} : { note: props.note })}
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

  it('shows its note under the options, outside the listbox', () => {
    renderListbox({ note: 'Some skills could not be read' });
    const note = screen.getByText('Some skills could not be read');
    expect(screen.getByRole('listbox')).not.toContainElement(note);
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('shows its note under what it says when nothing matches', () => {
    renderListbox({ options: [], note: 'Some skills could not be read' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText('No skill matches')).toBeInTheDocument();
    expect(
      screen.getByText('Some skills could not be read'),
    ).toBeInTheDocument();
  });

  it('shows no note unless given one', () => {
    const { container } = renderListbox();
    expect(container.textContent).toBe('/docx' + DESCRIPTION + '/pdf');
  });
});
