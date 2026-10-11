// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { LlmModelSwapDialog } from './llm-model-swap-dialog';

vi.mock('../hooks/use-llm-model-options', () => ({
  useLlmModelOptions: () => ({
    loaded: true,
    options: [
      {
        value: 'anthropic/claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        description: 'Anthropic',
      },
      { value: 'gpt-5-mini', label: 'GPT-5 mini', description: 'OpenAI' },
      {
        value: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash Lite',
        description: 'Google',
      },
    ],
  }),
}));

const DOCUMENT = {
  version: 1,
  name: 'github/triage-issues',
  nodes: [
    { id: 'score_issue', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
    { id: 'summary', type: 'llm', model: 'gpt-5-mini' },
    { id: 'draft_reply', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
    // An agent step runs on its harness's own lanes: it is not swapped.
    { id: 'fix', type: 'agent', model: 'anthropic/claude-haiku-4-5' },
  ],
};

function renderDialog() {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <LlmModelSwapDialog
      open
      onOpenChange={onOpenChange}
      organizationId="org-1"
      document={DOCUMENT}
      onApply={onApply}
    />,
  );
  return { ...view, onApply, onOpenChange };
}

const stepsListed = () =>
  within(screen.getByRole('list', { name: 'Steps that change' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('using another model in all steps', () => {
  it('lists the steps that name the model and swaps it for the one chosen', async () => {
    const { user, onApply, onOpenChange } = renderDialog();
    expect(
      screen.getByRole('dialog', { name: 'Use another model in all steps' }),
    ).toBeInTheDocument();
    expect(stepsListed()).toEqual(['Score issue', 'Draft reply']);

    const apply = screen.getByRole('button', { name: 'Use this model' });
    expect(apply).toBeDisabled();
    await user.click(screen.getByText('Choose the model to call'));
    // The model being replaced is no choice to replace it with.
    expect(
      screen.queryByRole('option', { name: /Claude Haiku 4.5/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('option', { name: /Gemini 3.5 Flash Lite/ }),
    );
    await user.click(apply);

    expect(onApply).toHaveBeenCalledWith(
      'anthropic/claude-haiku-4-5',
      'gemini-3.5-flash-lite',
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('replaces any model the document names, listing its own steps', async () => {
    const { user, onApply } = renderDialog();
    await user.click(screen.getByRole('combobox', { name: 'Replace' }));
    await user.click(
      await screen.findByRole('option', { name: 'gpt-5-mini · 1 step' }),
    );
    expect(stepsListed()).toEqual(['Summary']);

    await user.click(screen.getByText('Choose the model to call'));
    await user.click(screen.getByRole('option', { name: /Claude Haiku 4.5/ }));
    await user.click(screen.getByRole('button', { name: 'Use this model' }));
    expect(onApply).toHaveBeenCalledWith(
      'gpt-5-mini',
      'anthropic/claude-haiku-4-5',
    );
  });

  it('leaves the document as it is on Cancel', async () => {
    const { user, onApply, onOpenChange } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApply).not.toHaveBeenCalled();
  });
});
