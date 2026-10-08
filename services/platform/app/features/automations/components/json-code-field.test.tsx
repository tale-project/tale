import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { JsonCodeField, jsonFieldText } from './json-code-field';

/**
 * A JSON field commits only a value that parses and has the field's kind,
 * and never rewrites the author's text with the value its own commit
 * echoes back — the caret jump and the cleared field of the old box.
 */
function Owner({
  initial,
  expect: kind = 'object',
  onValue,
}: {
  initial: unknown;
  expect?: 'object' | 'array' | 'any';
  onValue?: (value: unknown) => void;
}) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <>
      <JsonCodeField
        label="Input"
        value={value}
        expect={kind}
        anchor={null}
        readOnly={false}
        onCommit={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
      <button type="button" onClick={() => setValue({ replaced: true })}>
        replace
      </button>
    </>
  );
}

describe('jsonFieldText', () => {
  it('shows a value as two-space JSON and an absent one as nothing', () => {
    expect(jsonFieldText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(jsonFieldText(undefined)).toBe('');
  });
});

describe('JsonCodeField', () => {
  it('keeps the text as typed when its own value comes back', async () => {
    const onValue = vi.fn();
    const { user } = render(<Owner initial={undefined} onValue={onValue} />);
    const box = screen.getByRole('textbox', { name: 'Input' });
    await user.type(box, '{{"a": 1}');
    // One line, as typed — not re-serialised over two.
    expect(box).toHaveValue('{"a": 1}');
    expect(onValue).toHaveBeenLastCalledWith({ a: 1 });
  });

  it('takes a value that changed for another reason', async () => {
    const { user } = render(<Owner initial={{ a: 1 }} />);
    await user.click(screen.getByRole('button', { name: 'replace' }));
    expect(screen.getByRole('textbox', { name: 'Input' })).toHaveValue(
      '{\n  "replaced": true\n}',
    );
  });

  it('clears the field when the text is blank', async () => {
    const onValue = vi.fn();
    const { user } = render(<Owner initial={{ a: 1 }} onValue={onValue} />);
    await user.clear(screen.getByRole('textbox', { name: 'Input' }));
    expect(onValue).toHaveBeenLastCalledWith(undefined);
  });

  it('says why text that is not JSON yet changes nothing', async () => {
    const onValue = vi.fn();
    const { user } = render(<Owner initial={undefined} onValue={onValue} />);
    await user.type(screen.getByRole('textbox', { name: 'Input' }), '{{"a":');
    expect(onValue).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'This is not valid JSON yet, so the node was not changed.',
      ),
    ).toBeVisible();
  });

  it('refuses a value of the wrong kind', async () => {
    const onValue = vi.fn();
    const { user } = render(<Owner initial={{ a: 1 }} onValue={onValue} />);
    const box = screen.getByRole('textbox', { name: 'Input' });
    await user.clear(box);
    onValue.mockClear();
    // `[[` types one bracket.
    await user.type(box, '[[1]');
    expect(onValue).not.toHaveBeenCalled();
    expect(
      screen.getByText('This must be a JSON object, in curly braces.'),
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks for a list where a list is due', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Owner initial={undefined} expect="array" onValue={onValue} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Input' }), '{{}');
    expect(
      screen.getByText('This must be a JSON list, in square brackets.'),
    ).toBeVisible();
    expect(onValue).not.toHaveBeenCalled();
  });

  it('takes any JSON value where any is due', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Owner initial={undefined} expect="any" onValue={onValue} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Input' }), '"hi"');
    expect(onValue).toHaveBeenLastCalledWith('hi');
  });
});
