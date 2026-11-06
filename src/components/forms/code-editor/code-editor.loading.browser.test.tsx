import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, it } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import {
  IssueFocusProvider,
  useRequestIssueFocus,
  type IssueFocusRange,
} from '../issue-focus';
import { CodeEditor } from './code-editor';

import '../../../globals.css';

/**
 * What happens before the editor's implementation has loaded. Each browser
 * test file runs in a fresh page, so the lazy chunk is cold here exactly
 * once: everything that needs it cold is one test.
 */

afterEach(cleanup);

const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

function Requests({
  anchor,
  range,
}: {
  anchor: string;
  range: IssueFocusRange;
}) {
  const request = useRequestIssueFocus();
  useEffect(() => {
    request(anchor, range);
  }, [anchor, range, request]);
  return null;
}

it('keeps its size while loading, and applies a go-to asked for meanwhile', async () => {
  const sizes = [
    { name: 'short', value: lines(1), minRows: 3, maxRows: 14 },
    { name: 'grown', value: lines(6), minRows: 3, maxRows: 14 },
    { name: 'capped', value: lines(30), minRows: 3, maxRows: 8 },
    { name: 'numbered', value: lines(4), minRows: 3, maxRows: 14 },
  ];
  render(
    <IssueFocusProvider>
      <div style={{ width: 480 }} className="flex flex-col gap-4">
        {sizes.map(({ name, value, minRows, maxRows }) => (
          <CodeEditor
            key={name}
            aria-label={name}
            language="text"
            value={value}
            minRows={minRows}
            maxRows={maxRows}
            lineNumbers={name === 'numbered'}
          />
        ))}
        <CodeEditor
          aria-label="Prompt"
          language="markdown"
          templates
          font="prose"
          value="Summarise {{ nodes.nope.output }} today"
          issueAnchor="/nodes/0/prompt"
        />
      </div>
      <Requests anchor="/nodes/0/prompt" range={[10, 33]} />
    </IssueFocusProvider>,
  );

  const frames = [
    ...document.querySelectorAll<HTMLElement>('[data-code-editor]'),
  ];
  expect(frames).toHaveLength(5);
  // Still the placeholder: the implementation has not arrived yet.
  expect(document.querySelector('[data-code-editor-loading]')).not.toBeNull();
  expect(frames[0]).toHaveAttribute('aria-busy', 'true');
  const loading = frames.map((frame) => frame.getBoundingClientRect().height);

  await waitFor(
    () => expect(document.querySelectorAll('.cm-editor')).toHaveLength(5),
    { timeout: 10_000 },
  );
  const loaded = frames.map((frame) => frame.getBoundingClientRect().height);
  expect(loaded).toEqual(loading);
  expect(frames[0]).not.toHaveAttribute('aria-busy');

  // The go-to asked for before the editor existed selected its range.
  const prompt = screen.getByRole('textbox', { name: 'Prompt' });
  await waitFor(() => expect(prompt).toHaveFocus());
  const selected = window.getSelection()?.toString();
  expect(selected).toBe('{{ nodes.nope.output }}');
});
