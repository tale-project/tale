import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import { CodeEditor } from './code-editor';

import '../../../globals.css';

/**
 * When the editor's implementation cannot load — a flaky connection, a
 * deploy that replaced its chunk — the failure stays in the field: the value
 * goes on in plain text, edits still reach the form, and the editor can be
 * tried again. Each browser test file runs in a fresh page, so the chunk is
 * cold here.
 */

const chunk = vi.hoisted(() => ({ fail: true, renders: 0 }));

// The implementation fails the way a chunk that did not load does: the
// lazy component rejects when it renders, until the "network" is back.
vi.mock('./code-editor-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./code-editor-view')>();
  const View = actual.default;
  return {
    ...actual,
    default: function FlakyView(props: Parameters<typeof View>[0]) {
      chunk.renders += 1;
      if (chunk.fail) {
        throw new TypeError('Failed to fetch dynamically imported module');
      }
      return <View {...props} />;
    },
  };
});

afterEach(cleanup);

function Draft() {
  const [value, setValue] = useState('return 1;');
  return (
    <>
      <CodeEditor
        aria-label="Code"
        language="javascript"
        value={value}
        onChange={setValue}
      />
      <output data-testid="draft">{value}</output>
    </>
  );
}

it('keeps the field editable in plain text when the editor does not load, and loads it on retry', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<Draft />);

  const plain = await screen.findByRole('textbox', { name: 'Code' });
  expect(plain.tagName).toBe('TEXTAREA');
  expect(plain).toHaveValue('return 1;');
  expect(
    screen.getByText(
      "The editor didn't load. You can keep editing here as plain text.",
    ),
  ).toBeVisible();

  // The draft keeps working: an edit in the plain field reaches the form.
  await userEvent.click(plain);
  await userEvent.keyboard('{End} // kept');
  expect(screen.getByTestId('draft')).toHaveTextContent('return 1; // kept');

  chunk.fail = false;
  await userEvent.click(
    screen.getByRole('button', { name: 'Try the editor again' }),
  );
  await waitFor(() =>
    expect(
      document.querySelector('[data-code-editor] .cm-content'),
    ).not.toBeNull(),
  );
  expect(chunk.renders).toBeGreaterThanOrEqual(2);
  expect(document.querySelector('textarea')).toBeNull();
  // The editor took over with the text the plain field left.
  expect(
    document.querySelector('[data-code-editor] .cm-content'),
  ).toHaveTextContent('return 1; // kept');
  warn.mockRestore();
  error.mockRestore();
});
