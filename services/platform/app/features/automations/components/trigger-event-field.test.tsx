import { within } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TriggerEventField } from './trigger-event-field';

function renderField(
  overrides: Partial<Parameters<typeof TriggerEventField>[0]> = {},
) {
  const onChange = vi.fn();
  const result = render(
    <TriggerEventField
      value=""
      onChange={onChange}
      canEdit
      modal={false}
      {...overrides}
    />,
  );
  return { ...result, onChange };
}

const fieldButton = () => screen.getByRole('button', { name: /^Event name/ });

describe('TriggerEventField', () => {
  // Nadia builds a triage automation: she looks for "when a task is
  // created" by what happens, not by the id the API uses — and still sees
  // the id beside it, since the pack she copies from names it.
  it('lists the events by group, each by name with its id and when it is raised', async () => {
    const { user } = renderField();
    await user.click(fieldButton());
    const list = await screen.findByRole('listbox');
    const text = list.textContent ?? '';
    // The groups come in the field's order, each before its events.
    const order = [
      'Tasks',
      'Comments',
      'Conversations',
      'Contacts',
      'Projects',
    ].map((group) => text.indexOf(group));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].toSorted((a, b) => a - b));
    const created = within(list).getByRole('option', {
      name: /^Task created/,
    });
    expect(created).toHaveTextContent('task.created');
    expect(created).toHaveTextContent(
      'A task is created on a board, through the API or by an import.',
    );
    // Ten events, and the group headings are not choices.
    expect(within(list).getAllByRole('option')).toHaveLength(10);
  });

  it('finds an event by its id as well as by its words', async () => {
    const { user } = renderField();
    await user.click(fieldButton());
    await user.type(
      await screen.findByRole('combobox', { name: 'Search events' }),
      'status_changed',
    );
    const list = screen.getByRole('listbox');
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([expect.stringMatching(/^Task status changed/)]);
  });

  it('says when nothing matches', async () => {
    const { user } = renderField();
    await user.click(fieldButton());
    await user.type(
      await screen.findByRole('combobox', { name: 'Search events' }),
      'invoice.paid',
    );
    expect(screen.getByText('No events match')).toBeVisible();
  });

  it('picks an event by its id', async () => {
    const { user, onChange } = renderField();
    await user.click(fieldButton());
    await user.click(
      await screen.findByRole('option', { name: /^Comment added/ }),
    );
    expect(onChange).toHaveBeenCalledWith('comment.created');
  });

  it('says under the field when the picked event is raised', () => {
    renderField({ value: 'comment.mentioned' });
    expect(fieldButton()).toHaveTextContent('Mentioned in a comment');
    expect(
      screen.getByText('A task comment mentions someone with @.'),
    ).toBeVisible();
    expect(fieldButton()).toHaveAccessibleDescription(
      'A task comment mentions someone with @.',
    );
  });

  it('describes nothing for a stored event the platform does not raise', () => {
    renderField({ value: 'invoice.paid' });
    expect(fieldButton()).not.toHaveAccessibleDescription(/./);
  });

  it('cannot be changed by a member', () => {
    renderField({ value: 'task.created', canEdit: false });
    expect(fieldButton()).toBeDisabled();
  });

  it('has no axe violations', async () => {
    const result = renderField({ value: 'task.created' });
    await checkAccessibility(result);
  });
});
