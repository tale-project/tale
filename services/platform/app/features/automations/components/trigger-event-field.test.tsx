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

const LOOP =
  "Its own runs never start it again, and a run that an event started doesn't start other automations.";

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
      `A task comment mentions someone with @. ${LOOP}`,
    );
  });

  it('says only the loop rule for a stored event the platform does not raise, while the projects are unknown', () => {
    renderField({ value: 'invoice.paid' });
    expect(fieldButton()).toHaveAccessibleDescription(LOOP);
  });

  // Ada's triage automation belongs to the organization: a task created in
  // any project starts it, and so does a contact, which has no project.
  it('says an automation of the organization hears every project’s events [AUTO-R35]', () => {
    renderField({ value: 'task.created', installedIn: [] });
    expect(
      screen.getByText(
        'Starts for matching events in every project, and for events that belong to no project.',
      ),
    ).toBeVisible();
  });

  // Noah installed it in Billing and Sales only: a task in Support starts
  // nothing, a contact still does.
  it('names the projects whose events reach an installed automation [AUTO-R35]', () => {
    renderField({ value: 'task.created', installedIn: ['Billing', 'Sales'] });
    expect(fieldButton()).toHaveAccessibleDescription(
      `A task is created on a board, through the API or by an import. Starts for matching events in Billing and Sales, and for events that belong to no project, such as contacts. ${LOOP}`,
    );
  });

  // Mia's sync files a task the triage automation hears; the triage run's
  // own writes start nothing.
  it('says its own runs never start it again, and an event-started run starts nothing else [AUTO-R12]', () => {
    renderField({ value: '', installedIn: [] });
    expect(screen.getByText(LOOP)).toBeVisible();
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
