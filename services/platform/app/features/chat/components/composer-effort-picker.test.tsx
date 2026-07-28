// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ComposerModelOption, ComposerSelection } from '../types';
import { ComposerEffortPicker } from './composer-effort-picker';

const REASONING_MODEL: ComposerModelOption = {
  id: 'claude-fable-5',
  label: 'claude-fable-5',
  providerSlug: 'anthropic',
  credential: { authMethod: 'api-key' },
  reasoning: { knob: 'budget-tokens' },
};

const PLAIN_MODEL: ComposerModelOption = {
  id: 'small-model',
  label: 'small-model',
  providerSlug: 'openai',
  credential: { authMethod: 'api-key' },
};

const SELECTION: ComposerSelection = {
  agentKind: 'platform',
  modelId: 'claude-fable-5',
  providerSlug: 'anthropic',
  skills: [],
  connectors: [],
};

describe('ComposerEffortPicker', () => {
  it('renders nothing for a model without a reasoning knob', () => {
    const { container } = render(
      <ComposerEffortPicker
        model={PLAIN_MODEL}
        selection={SELECTION}
        onSelectionChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Default plus the five levels and reports a pick', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ComposerEffortPicker
        model={REASONING_MODEL}
        selection={SELECTION}
        onSelectionChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    for (const label of ['Default', 'Low', 'Medium', 'High', 'Extra', 'Max']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('menuitem', { name: 'Max' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'max' }),
    );
  });

  it('shows the current level on the trigger and clears back to Default', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ComposerEffortPicker
        model={REASONING_MODEL}
        selection={{ ...SELECTION, reasoningEffort: 'high' }}
        onSelectionChange={onChange}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Reasoning effort' }),
    ).toHaveTextContent('High');

    await user.click(screen.getByRole('button', { name: 'Reasoning effort' }));
    await user.click(screen.getByRole('menuitem', { name: 'Default' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: undefined }),
    );
  });
});
