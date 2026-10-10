import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen } from '@/tests/utils/render';

import type { MissingInputField } from '../lib/fixed-input';
import {
  TriggerFixedInput,
  type TriggerFixedInputHandle,
} from './trigger-fixed-input';

/** The GitHub triage pack's inputs that its schedule does not send. */
const OWNER_REPO: MissingInputField[] = [
  { name: 'owner', type: 'string' },
  { name: 'repo', type: 'string' },
];

/** The field, holding its own text as the editor's draft does. */
function Harness({
  initial = '',
  missing = [],
  canEdit = true,
  onChange = () => {},
  handle,
}: {
  initial?: string;
  missing?: MissingInputField[];
  canEdit?: boolean;
  onChange?: (value: string) => void;
  handle?: React.Ref<TriggerFixedInputHandle>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TriggerFixedInput
      ref={handle}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      canEdit={canEdit}
      missing={missing}
    />
  );
}

const field = () => screen.getByRole('textbox', { name: 'Fixed input' });
const details = (summary: string) => {
  const element = screen
    .getByText(summary, { selector: 'summary' })
    .closest('details');
  if (element === null) throw new Error(`no details ${summary}`);
  return element;
};

describe('TriggerFixedInput', () => {
  it('stays folded as "Add fixed input" while it is empty and nothing is missing', () => {
    render(<Harness />);
    expect(details('Add fixed input')).not.toHaveAttribute('open');
  });

  it('opens on a stored value', () => {
    render(<Harness initial={'{\n  "owner": "acme"\n}'} />);
    expect(details('Fixed input')).toHaveAttribute('open');
    expect(field()).toHaveValue('{\n  "owner": "acme"\n}');
  });

  it('opens once the deployed inputs turn out to need a field', () => {
    const { rerender } = render(<Harness />);
    expect(details('Add fixed input')).not.toHaveAttribute('open');
    rerender(<Harness missing={OWNER_REPO} />);
    expect(details('Add fixed input')).toHaveAttribute('open');
  });

  it('says text that is not JSON is not JSON', async () => {
    const { user } = render(<Harness initial="{}" />);
    await user.clear(field());
    await user.type(field(), 'owner: acme');
    expect(screen.getByText("This isn't valid JSON.")).toBeVisible();
  });

  it('names the trigger’s own fields a fixed input may not set', async () => {
    const { user } = render(<Harness initial="{}" />);
    await user.clear(field());
    await user.paste('{"trigger": "x", "event": "y", "owner": "acme"}');
    expect(
      screen.getByText(
        'Remove trigger and event: the trigger sets these fields itself.',
      ),
    ).toBeVisible();
  });

  it('says a value that is no object must be one', async () => {
    const { user } = render(<Harness initial="{}" />);
    await user.clear(field());
    await user.paste('[1, 2]');
    expect(
      screen.getByText('The fixed input must be a JSON object.'),
    ).toBeVisible();
  });

  // Ada's GitHub triage schedule: version 3 needs owner and repo, which a
  // schedule never sends. One click writes both, and the caret waits in the
  // first one's quotes.
  it('adds the missing fields as typed placeholders and puts the caret in the first', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <Harness missing={OWNER_REPO} onChange={onChange} />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Add the 2 missing fields' }),
    );
    const text = '{\n  "owner": "",\n  "repo": ""\n}';
    expect(onChange).toHaveBeenLastCalledWith(text);
    expect(field()).toHaveValue(text);
    expect(field()).toHaveFocus();
    const caret = text.indexOf('"owner": "') + '"owner": "'.length;
    expect((field() as HTMLTextAreaElement).selectionStart).toBe(caret);
    expect((field() as HTMLTextAreaElement).selectionEnd).toBe(caret);
  });

  it('fills from outside — a skip notice’s button — opening a folded field first', async () => {
    const handle = createRef<TriggerFixedInputHandle>();
    const { user } = render(<Harness missing={OWNER_REPO} handle={handle} />);
    // The reader folded it away.
    await user.click(screen.getByText('Add fixed input'));
    expect(details('Add fixed input')).not.toHaveAttribute('open');
    act(() => handle.current?.fillMissing());
    expect(details('Fixed input')).toHaveAttribute('open');
    expect(field()).toHaveFocus();
  });

  it('offers no fill when the text is no object to add to', () => {
    render(<Harness initial="not json" missing={OWNER_REPO} />);
    expect(screen.queryByRole('button', { name: /missing field/ })).toBeNull();
  });

  it('shows a member the stored value read-only, with nothing to add', () => {
    render(
      <Harness
        initial={'{"owner": "acme"}'}
        canEdit={false}
        missing={OWNER_REPO}
      />,
    );
    expect(field()).toHaveAttribute('readonly');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing for a member when it is empty', () => {
    const { container } = render(<Harness canEdit={false} />);
    expect(container.querySelector('details')).toBeNull();
  });

  it('has no axe violations open with an error', async () => {
    const result = render(<Harness initial="{" missing={OWNER_REPO} />);
    await checkAccessibility(result);
  });
});
