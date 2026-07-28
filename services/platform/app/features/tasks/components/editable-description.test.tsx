// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

// The mention machinery is a separate concern with its own tests, and it talks
// to Convex; this file is about WHEN the field is a textarea and when it is
// just its own trigger.
vi.mock('./mention-textarea', () => ({
  MentionTextarea: ({
    label,
    value,
    placeholder,
    onValueChange,
    autoFocus,
  }: {
    label?: string;
    value: string;
    placeholder?: string;
    onValueChange: (value: string) => void;
    autoFocus?: boolean;
  }) => (
    <label>
      {label}
      <textarea
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </label>
  ),
}));

vi.mock('./mention-trigger-chips', () => ({
  MentionTriggerChips: () => null,
}));

import { EditableDescription } from './editable-description';

function renderField(value: string, onSave = vi.fn()) {
  return {
    onSave,
    ...render(
      <EditableDescription
        taskId={'task_1' as Id<'tasks'>}
        organizationId="org_1"
        projectId={'project_1' as Id<'projects'>}
        value={value}
        label="Description"
        placeholder="Add a description…"
        onSave={onSave}
      />,
    ),
  };
}

describe('EditableDescription', () => {
  // An empty description must not spend the top of the task modal on a
  // six-row textarea nobody asked for — least of all on an automation-owned
  // task, where the work (upload, Start) is what the reader came for.
  it('is only its own trigger while nothing is written', () => {
    renderField('');

    expect(
      screen.getByRole('button', { name: 'Add a description…' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('opens a labelled, focused textarea when asked for', async () => {
    const { user } = renderField('');

    await user.click(
      screen.getByRole('button', { name: 'Add a description…' }),
    );

    const field = screen.getByRole('textbox', { name: 'Description' });
    expect(field).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Add a description…' }),
    ).toBeNull();
  });

  it('opens straight into the editor when a description exists', () => {
    renderField('Includes the March bordereau correction.');

    const field = screen.getByRole('textbox', { name: 'Description' });
    expect(field).toHaveValue('Includes the March bordereau correction.');
    // Never steals focus from the modal on open — only an explicit ask does.
    expect(field).not.toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Add a description…' }),
    ).toBeNull();
  });

  it('saves the draft on demand and keeps the editor open after', async () => {
    const { user, onSave } = renderField('');

    await user.click(
      screen.getByRole('button', { name: 'Add a description…' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Q2 excludes the March bordereau.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('Q2 excludes the March bordereau.');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Q2 excludes the March bordereau.',
    );
  });

  it('offers Save / Discard only while the draft differs', async () => {
    const { user } = renderField('Filed by the desk.');

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    const field = screen.getByRole('textbox', { name: 'Description' });
    await user.type(field, ' Reviewed.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(field).toHaveValue('Filed by the desk.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
