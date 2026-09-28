// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { TASK_DESCRIPTION_MAX } from '@/backend/core/tasks/helpers';
import { render, screen } from '@/tests/utils/render';

// The mention machinery is a separate concern with its own tests, and it talks
// to Convex; this file is about WHEN the field is prose, when it is a textarea,
// and when it is just its own trigger.
vi.mock('./mention-textarea', () => ({
  MentionTextarea: ({
    label,
    value,
    placeholder,
    onValueChange,
    onKeyDown,
    errorMessage,
    autoFocus,
  }: {
    label?: string;
    value: string;
    placeholder?: string;
    onValueChange: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    errorMessage?: string;
    autoFocus?: boolean;
  }) => (
    <>
      <label>
        {label}
        <textarea
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </label>
      {/* The real field renders its error the way `Textarea` does. */}
      {errorMessage !== undefined && <p role="alert">{errorMessage}</p>}
    </>
  ),
}));

vi.mock('./mention-trigger-chips', () => ({
  MentionTriggerChips: () => null,
}));

// The read view renders for real — it is the whole point of the field — but the
// directory it resolves `@handles` against is a Convex query, and the shared
// component map pulls chat chrome (images, citations, the router-aware anchor).
// Stubbing the map leaves react-markdown's own renderers in place, so the
// anchors below are the ones the markdown pipeline actually produced.
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({ members: [], agents: [], automations: [] }),
}));
vi.mock('@/app/features/shared/markdown/markdown-renderer', () => ({
  markdownWrapperStyles: '',
  markdownComponents: {},
}));

import { EditableDescription } from './editable-description';

const WRITTEN =
  'See [the runbook](https://example.com/runbook) before starting.';

function renderField(
  value: string,
  onSave: (value: string) => void | Promise<unknown> = vi.fn(),
) {
  const field = (next: string) => (
    <EditableDescription
      taskId={'task_1' as string}
      organizationId="org_1"
      projectId={'project_1' as string}
      value={next}
      label="Description"
      placeholder="Add a description…"
      onSave={onSave}
    />
  );
  const utils = render(field(value));
  return {
    onSave,
    ...utils,
    /** Echo a saved value back, the way the live Convex query does. */
    rerenderWith: (next: string) => utils.rerender(field(next)),
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

  // The regression this field was rewritten for: a permanently-open textarea
  // holds RAW text, so every link anyone wrote in a description was dead plain
  // text for exactly the people allowed to edit the task.
  it('reads as rendered prose, with its links live', () => {
    renderField(WRITTEN);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'the runbook' })).toHaveAttribute(
      'href',
      'https://example.com/runbook',
    );
    expect(screen.queryByText(WRITTEN)).toBeNull();
  });

  it('opens the editor from Edit, seeded with the saved text', async () => {
    const { user } = renderField(WRITTEN);

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const field = screen.getByRole('textbox', { name: 'Description' });
    expect(field).toHaveValue(WRITTEN);
    expect(field).toHaveFocus();
    expect(screen.queryByRole('link', { name: 'the runbook' })).toBeNull();
  });

  it('opens the editor when the prose itself is clicked', async () => {
    const { user } = renderField(WRITTEN);

    await user.click(screen.getByText(/before starting/));

    expect(
      screen.getByRole('textbox', { name: 'Description' }),
    ).toBeInTheDocument();
  });

  // Following a link must not double as "edit this" — the click that navigates
  // would otherwise swap the prose out for a textarea on the way out.
  it('leaves the prose alone when a link inside it is clicked', async () => {
    const { user } = renderField(WRITTEN);

    await user.click(screen.getByRole('link', { name: 'the runbook' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'the runbook' })).toBeVisible();
  });

  it('saves the draft and returns to the prose', async () => {
    const { user, onSave, rerenderWith } = renderField('');

    await user.click(
      screen.getByRole('button', { name: 'Add a description…' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Q2 excludes the March bordereau.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('Q2 excludes the March bordereau.');
    expect(screen.queryByRole('textbox')).toBeNull();
    rerenderWith('Q2 excludes the March bordereau.');
    expect(
      screen.getByText('Q2 excludes the March bordereau.'),
    ).toBeInTheDocument();
  });

  it('offers Save only while the draft differs, and discards back to the prose', async () => {
    const { user, onSave } = renderField('Filed by the desk.');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      ' Reviewed.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Filed by the desk.')).toBeInTheDocument();
  });

  // A rejected write must not swallow what was typed: the caller has already
  // reported the failure, so the field's job is to keep the draft on screen.
  it('keeps the editor and the draft when the save fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { user } = renderField('Filed by the desk.', () =>
      Promise.reject(new Error('offline')),
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      ' Reviewed.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Filed by the desk. Reviewed.',
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // An older import stored descriptions whole, past the cap the server now
  // holds every write to, and saving one answered only the generic error
  // toast. The editor names the cap under the draft and holds the save —
  // the button and ⌘/Ctrl+Enter alike — until the draft fits.
  it('names the cap under a draft past it and holds the save until it fits', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { user } = renderField('d'.repeat(TASK_DESCRIPTION_MAX + 1), onSave);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This description has 20,001 characters; the limit is 20,000. ' +
        'Shorten it to save. Most emoji count as 2.',
    );

    const field = screen.getByRole('textbox', { name: 'Description' });
    await user.type(field, ' and more');
    expect(screen.getByRole('alert')).toHaveTextContent('20,010 characters');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSave).not.toHaveBeenCalled();

    // Back at the cap, the hint goes and the save is offered again.
    await user.type(field, '{Backspace}'.repeat(10));
    expect(field).toHaveValue('d'.repeat(TASK_DESCRIPTION_MAX));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('d'.repeat(TASK_DESCRIPTION_MAX));
  });

  it('measures the draft as the save sends it, trimmed', async () => {
    const { user } = renderField('Short.');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByRole('textbox', { name: 'Description' });
    await user.clear(field);
    await user.click(field);
    await user.paste(`  ${'d'.repeat(TASK_DESCRIPTION_MAX)}\n`);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
