import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { customRow, type FormValues, type RowValues } from '../lib/form';
import { SecretFieldRow } from './secret-field-row';

const PASSWORD: RowValues = {
  template: 'Password',
  multiline: false,
  label: 'Password',
  value: '',
  hidden: true,
  decided: false,
};
const WEBSITE: RowValues = {
  ...PASSWORD,
  template: 'Website',
  label: 'Website',
  hidden: false,
};
const ADDRESS: RowValues = {
  ...WEBSITE,
  template: 'Address',
  label: 'Address',
  multiline: true,
};
const NOTE_KEY: RowValues = {
  ...ADDRESS,
  template: 'Private key',
  label: 'Private key',
  hidden: true,
};

const noop = () => {};

interface HostProps {
  rows: RowValues[];
  labelError?: string;
  valueError?: string;
  onRemove?: (index: number) => void;
}

/** The form a row lives in: its values are shown, as JSON, for a test to read. */
function Host({ rows, labelError, valueError, onRemove = noop }: HostProps) {
  const form = useForm<FormValues>({
    defaultValues: { kind: 'credentials', title: '', scope: 'global', rows },
  });
  const values = form.watch();
  const { toasts } = useToast();
  return (
    <>
      {rows.map((row, index) => (
        <SecretFieldRow
          key={`${row.label}-${index}`}
          index={index}
          fixedLabel={row.template === null ? undefined : row.template}
          multiline={row.multiline}
          position={index + 1}
          control={form.control}
          register={form.register}
          setValue={form.setValue}
          labelError={labelError}
          valueError={valueError}
          onRemove={onRemove}
        />
      ))}
      <pre data-testid="values">{JSON.stringify(values.rows)}</pre>
      <pre data-testid="toasts">{openToasts(toasts).length}</pre>
    </>
  );
}

function stored(): RowValues[] {
  return JSON.parse(screen.getByTestId('values').textContent ?? '[]');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SecretFieldRow of a starting row', () => {
  it('has a fixed label for its value, and no label to type nor row to remove', () => {
    renderApp(<Host rows={[WEBSITE]} />);
    expect(
      screen.getByRole('textbox', { name: 'Website' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Label' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Remove/ }),
    ).not.toBeInTheDocument();
  });

  it('is no group of its own: the values are one group, a row the person added is a group in it', () => {
    renderApp(<Host rows={[WEBSITE]} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('writes what is typed to the form', async () => {
    const { user } = renderApp(<Host rows={[WEBSITE]} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Website' }),
      'example.com',
    );
    expect(stored()[0]?.value).toBe('example.com');
  });

  it('is no password for the browser, whatever the value is', () => {
    renderApp(<Host rows={[WEBSITE, PASSWORD]} />);
    for (const name of ['Website', 'Password']) {
      const field = screen.getByLabelText(name);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('spellcheck', 'false');
    }
    expect(screen.getByLabelText('Password')).toHaveAttribute('data-1p-ignore');
  });

  it('shows a value that is not hidden as it is, without a way to show or copy it', () => {
    renderApp(<Host rows={[WEBSITE]} />);
    expect(
      screen.queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Copy/ }),
    ).not.toBeInTheDocument();
  });

  it('asks in words whether to keep its value hidden: a checkbox, checked for what a kind hides', () => {
    renderApp(<Host rows={[WEBSITE, PASSWORD]} />);
    const boxes = screen.getAllByRole('checkbox', { name: /^Keep hidden/ });
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it('names the choice for the value it is about, the words on screen first', () => {
    renderApp(<Host rows={[WEBSITE, PASSWORD, customRow()]} />);
    expect(
      screen.getByRole('checkbox', { name: 'Keep hidden: Website' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Keep hidden: Password' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Keep hidden: Field 3' }),
    ).not.toBeChecked();
    // On screen it says the same thing three times, short.
    expect(screen.getAllByText('Keep hidden')).toHaveLength(3);
  });

  it('can be told to keep its value hidden, and masks it at once', async () => {
    const { user } = renderApp(<Host rows={[WEBSITE]} />);
    const keep = screen.getByRole('checkbox', { name: /^Keep hidden/ });

    await user.click(keep);

    expect(keep).toBeChecked();
    expect(stored()[0]).toMatchObject({ hidden: true, decided: true });
    expect(
      screen.getByRole('button', { name: 'Show Website' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: 'Copy Website' }),
    ).toBeInTheDocument();
  });

  it('can be told to stop hiding it, which the server is then told as it is', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    const keep = screen.getByRole('checkbox', { name: /^Keep hidden/ });

    await user.click(keep);

    expect(keep).not.toBeChecked();
    expect(stored()[0]).toMatchObject({ hidden: false, decided: true });
    expect(
      screen.queryByRole('button', { name: 'Show Password' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy Password' }),
    ).not.toBeInTheDocument();
  });

  it('shows the error of its value beside it', () => {
    renderApp(<Host rows={[WEBSITE]} valueError="That is too long." />);
    expect(
      screen.getByRole('textbox', { name: 'Website' }),
    ).toHaveAccessibleDescription('That is too long.');
    expect(screen.getByRole('alert')).toHaveTextContent('That is too long.');
  });
});

describe('SecretFieldRow with a value that is hidden', () => {
  it('is a password field while hidden, so that assistive technology does not read the value out', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    // A password field has no role of a text field: the value typed into it is
    // not spoken back, which a masked text field would do.
    expect(
      screen.queryByRole('textbox', { name: 'Password' }),
    ).not.toBeInTheDocument();
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    await user.type(field, 'hunter2');
    expect(field).toHaveValue('hunter2');

    // Shown on request, it is the text field a person can check.
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(screen.getByRole('textbox', { name: 'Password' })).toHaveValue(
      'hunter2',
    );
    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('is a password field for any value kept hidden, not only the starting ones', async () => {
    const { user } = renderApp(<Host rows={[WEBSITE]} />);
    expect(screen.getByRole('textbox', { name: 'Website' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /^Keep hidden/ }));
    expect(
      screen.queryByRole('textbox', { name: 'Website' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Website')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('holds the value in the field with the buttons beside it, inside its edge: show, then copy', () => {
    renderApp(<Host rows={[PASSWORD]} />);
    const field = screen.getByLabelText('Password');
    const show = screen.getByRole('button', { name: 'Show Password' });
    const copy = screen.getByRole('button', { name: 'Copy Password' });
    expect(field.parentElement).toContainElement(show);
    expect(field.parentElement).toContainElement(copy);
  });

  it('shows the value when asked and masks it again when asked', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(
      screen.getByRole('button', { name: 'Hide Password' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByRole('button', { name: 'Show Password' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(
      screen.getByRole('button', { name: 'Show Password' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps what was typed when it is shown and masked', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(screen.getByLabelText('Password')).toHaveValue('hunter2');
    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(screen.getByLabelText('Password')).toHaveValue('hunter2');
    expect(stored()[0]?.value).toBe('hunter2');
  });

  it('does not change what is stored when the value is shown (showing is not a decision)', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(stored()[0]).toMatchObject({ hidden: true, decided: false });
  });

  it('copies the value without showing it, and says it did', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.type(screen.getByLabelText('Password'), 'hunter2');

    await user.click(screen.getByRole('button', { name: 'Copy Password' }));

    expect(writeText).toHaveBeenCalledWith('hunter2');
    expect(
      screen.getByRole('button', { name: 'Show Password' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Password copied'),
    );
  });

  it('copies nothing when there is nothing to copy', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy Password' }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('tells the person when the browser does not let it copy', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Copy Password' }));
    await waitFor(() =>
      expect(screen.getByTestId('toasts')).toHaveTextContent('1'),
    );
  });

  it('is masked again by making it hidden after it was not, even if it was shown before', async () => {
    const { user } = renderApp(<Host rows={[WEBSITE]} />);
    const keep = screen.getByRole('checkbox', { name: /^Keep hidden/ });
    await user.click(keep);
    await user.click(screen.getByRole('button', { name: 'Show Website' }));
    expect(
      screen.getByRole('button', { name: 'Hide Website' }),
    ).toBeInTheDocument();
    // Stop hiding and hide again: it is masked, not left shown.
    await user.click(keep);
    await user.click(keep);
    expect(
      screen.getByRole('button', { name: 'Show Website' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the typed value when it stops being hidden and is hidden again', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    const keep = screen.getByRole('checkbox', { name: /^Keep hidden/ });
    await user.click(keep);
    expect(screen.getByLabelText('Password')).toHaveValue('hunter2');
    await user.click(keep);
    expect(screen.getByLabelText('Password')).toHaveValue('hunter2');
    expect(stored()[0]?.value).toBe('hunter2');
  });
});

describe('SecretFieldRow of text with several lines', () => {
  it('is a text area, which keeps its lines', async () => {
    const { user } = renderApp(<Host rows={[ADDRESS]} />);
    const area = screen.getByRole('textbox', { name: 'Address' });
    expect(area.tagName).toBe('TEXTAREA');
    await user.type(area, 'Street 1{Enter}10117 Berlin');
    expect(stored()[0]?.value).toBe('Street 1\n10117 Berlin');
  });

  it('is masked as a whole when it is hidden, and can be shown and copied whole', async () => {
    const { user } = renderApp(<Host rows={[NOTE_KEY]} />);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const area = screen.getByRole('textbox', { name: 'Private key' });
    await user.type(area, 'line one{Enter}line two');
    expect(area.tagName).toBe('TEXTAREA');

    await user.click(screen.getByRole('button', { name: 'Copy Private key' }));
    expect(writeText).toHaveBeenCalledWith('line one\nline two');

    await user.click(screen.getByRole('button', { name: 'Show Private key' }));
    expect(
      screen.getByRole('button', { name: 'Hide Private key' }),
    ).toBeInTheDocument();
    expect(area).toHaveValue('line one\nline two');
  });

  it('is no password for the browser either', () => {
    renderApp(<Host rows={[NOTE_KEY]} />);
    expect(
      screen.getByRole('textbox', { name: 'Private key' }),
    ).toHaveAttribute('data-1p-ignore');
  });
});

describe('SecretFieldRow the person added', () => {
  const added = customRow();

  it('has a label to type and a value, each with its own visible label, in a group that names which row they belong to', () => {
    renderApp(<Host rows={[WEBSITE, added]} />);
    const group = screen.getByRole('group', { name: 'Field 2' });
    expect(
      within(group).getByRole('textbox', { name: 'Label' }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('textbox', { name: 'Value' }),
    ).toBeInTheDocument();
    expect(within(group).getByText('Label')).toBeVisible();
    expect(within(group).getByText('Value')).toBeVisible();
  });

  it('is named by the label once it has one', async () => {
    const { user } = renderApp(<Host rows={[added]} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Label' }),
      'Backup code',
    );

    const group = screen.getByRole('group', { name: 'Backup code' });
    expect(
      within(group).getByRole('checkbox', { name: /^Keep hidden/ }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: 'Remove Backup code' }),
    ).toBeInTheDocument();
    expect(stored()[0]?.label).toBe('Backup code');
  });

  it('writes the label and the value to the form', async () => {
    const { user } = renderApp(<Host rows={[added]} />);
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'PIN');
    await user.type(screen.getByRole('textbox', { name: 'Value' }), '4821');
    expect(stored()[0]).toMatchObject({ label: 'PIN', value: '4821' });
  });

  it('is removed on request, and says which row to remove', async () => {
    const onRemove = vi.fn();
    const { user } = renderApp(
      <Host rows={[WEBSITE, added]} onRemove={onRemove} />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove Field 2' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('shows the errors of its label and its value beside each', () => {
    renderApp(
      <Host
        rows={[added]}
        labelError="Needs a label."
        valueError="Too long."
      />,
    );
    expect(
      screen.getByRole('textbox', { name: 'Label' }),
    ).toHaveAccessibleDescription('Needs a label.');
    expect(
      screen.getByRole('textbox', { name: 'Value' }),
    ).toHaveAccessibleDescription('Too long.');
  });

  it('can be hidden, then masks its value and offers to show and copy it, named by its label', async () => {
    const { user } = renderApp(<Host rows={[added]} />);
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'PIN');
    await user.type(screen.getByRole('textbox', { name: 'Value' }), '4821');

    await user.click(screen.getByRole('checkbox', { name: /^Keep hidden/ }));

    expect(
      screen.getByRole('button', { name: 'Show PIN' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy PIN' }),
    ).toBeInTheDocument();
    expect(stored()[0]).toMatchObject({ hidden: true, decided: true });
  });

  it('is named by its place while it has no label, and its buttons with it', async () => {
    const { user } = renderApp(<Host rows={[added]} />);
    await user.click(screen.getByRole('checkbox', { name: /^Keep hidden/ }));
    expect(
      screen.getByRole('button', { name: 'Show Field 1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Field 1' }),
    ).toBeInTheDocument();
  });

  it('has a value of several lines in a text area, which can be hidden too', () => {
    renderApp(
      <Host
        rows={[customRow({ label: 'Key', value: 'a\nb', multiline: true })]}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Value' }).tagName).toBe(
      'TEXTAREA',
    );
  });
});

describe('SecretFieldRow with the keyboard', () => {
  it('reaches the value, then its buttons, then the choice to keep it hidden, in reading order', async () => {
    const { user } = renderApp(<Host rows={[PASSWORD]} />);
    await user.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy Password' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show Password' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Hide Password' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('checkbox', { name: /^Keep hidden/ }),
    ).toHaveFocus();
    await user.keyboard(' ');
    expect(
      screen.getByRole('checkbox', { name: /^Keep hidden/ }),
    ).not.toBeChecked();
  });

  it('reaches the label, the remove button, the value and the choice of an added row, in reading order', async () => {
    const { user } = renderApp(<Host rows={[customRow()]} />);
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Remove Field 1' }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('checkbox', { name: /^Keep hidden/ }),
    ).toHaveFocus();
  });
});

describe('SecretFieldRow in a form', () => {
  it('has no accessibility violations: starting, hidden, text area and added rows', async () => {
    const view = renderApp(
      <Host
        rows={[
          WEBSITE,
          PASSWORD,
          ADDRESS,
          NOTE_KEY,
          customRow({ label: 'PIN', value: '1' }),
        ]}
        labelError="Check this."
        valueError="Check that."
      />,
    );
    await checkAccessibility(view);
  });
});
