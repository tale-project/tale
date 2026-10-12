import { describe, expect, it, vi } from 'vitest';

import type { RunForTest } from '@/lib/automations/tests/test-from-run';
import type { Automation } from '@/lib/engine/core/types';
import { render, screen, within } from '@/tests/utils/render';

import { SaveAsTestDialog } from './save-as-test-dialog';

const DOC: Pick<Automation, 'nodes'> = {
  nodes: [
    { id: 'summary', type: 'llm', prompt: 'Sum it up.' },
    { id: 'shape', type: 'transform', code: 'return input;' },
  ],
};

const SUCCEEDED: RunForTest = {
  mode: 'live',
  status: 'success',
  input: { customer: 'acme' },
  output: { text: 'All paid.' },
  trace: [
    {
      node: 'summary',
      type: 'llm',
      status: 'ok',
      output: { text: 'All paid.' },
    },
    { node: 'shape', type: 'transform', status: 'ok', output: {} },
  ],
  effects: [],
  startedAt: Date.UTC(2026, 9, 11, 15, 2),
};

function renderDialog(run: RunForTest = SUCCEEDED) {
  const onAdd = vi.fn();
  const view = render(
    <SaveAsTestDialog
      run={run}
      runVersion={2}
      document={DOC}
      version={3}
      onClose={() => {}}
      onAdd={onAdd}
    />,
  );
  return { ...view, onAdd };
}

describe('saving a run as a test', () => {
  it('explains the saved copy lifecycle before adding ordinary run data', () => {
    const { onAdd } = renderDialog();
    expect(
      screen.getByText(
        /The copies can remain after the source run is deleted or removed through retention or erasure/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /use synthetic examples for personal data before saving/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('expects what a succeeded run returned and stands in for its model', async () => {
    const { user, onAdd } = renderDialog();
    const dialog = screen.getByRole('dialog', {
      name: 'Save the run as a test',
    });
    expect(
      within(dialog).getByRole('radio', { name: 'It returns this output' }),
    ).toBeChecked();
    // A model answers as it did; code is what the test checks.
    expect(
      within(dialog).getByRole('checkbox', { name: 'Summary' }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Shape' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText('Your code is what the test checks.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /This run used version 2; the test is added to your draft of version 3\./,
      ),
    ).toBeInTheDocument();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Paid customer');
    await user.click(within(dialog).getByRole('button', { name: 'Add test' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Paid customer',
        input: { customer: 'acme' },
        mocks: { summary: { text: 'All paid.' } },
        expect: expect.objectContaining({ output: { text: 'All paid.' } }),
      }),
    );
  });

  it('expects a failed run to succeed by default, or to fail where it failed', async () => {
    const failed: RunForTest = {
      ...SUCCEEDED,
      status: 'failed',
      output: undefined,
      trace: [
        { node: 'summary', type: 'llm', status: 'error', error: 'refused' },
      ],
      error: { nodeId: 'summary', message: 'refused' },
    };
    const { user, onAdd } = renderDialog(failed);
    const succeeds = screen.getByRole('radio', { name: /It succeeds/ });
    expect(succeeds).toBeChecked();
    expect(
      screen.getByText(
        'The run failed, so the test fails until that is fixed.',
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('radio', { name: 'It fails at Summary' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add test' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        expect: expect.objectContaining({
          failure: expect.objectContaining({ node: 'summary' }),
        }),
      }),
    );
  });

  it('says when it left out a value that looked like a secret', () => {
    renderDialog({
      ...SUCCEEDED,
      input: { apiKey: 'sk-live-0123456789abcdefghijklmnop' },
    });
    expect(
      screen.getByText('1 value looked like a secret and is left out.'),
    ).toBeInTheDocument();
  });
});
