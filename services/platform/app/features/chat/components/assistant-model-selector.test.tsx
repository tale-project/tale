import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { AssistantModelSelector } from './assistant-model-selector';

// The two pickers are heavy (Convex-backed); stub them — this component's job
// is to collapse them behind one button and reveal both on demand.
vi.mock('./agent-selector', () => ({
  AgentSelector: () => <div data-testid="agent-selector-stub" />,
}));
vi.mock('./model-selector', () => ({
  ModelSelector: () => <div data-testid="model-selector-stub" />,
}));
vi.mock('../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({ agent: null, isLoading: false }),
}));
vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({ selectedModelOverrides: {} }),
}));

describe('AssistantModelSelector', () => {
  it('collapses to one button and reveals both pickers on demand', async () => {
    const { user } = render(<AssistantModelSelector organizationId="org-1" />);

    // Collapsed: a single control; neither picker is mounted yet.
    const trigger = screen.getByRole('button', {
      name: enMessages.chat.assistantModelSelector.label,
    });
    expect(screen.queryByTestId('agent-selector-stub')).not.toBeInTheDocument();

    await user.click(trigger);

    // Opened: one labelled group holding BOTH pickers (agent + model).
    const group = await screen.findByRole('group', {
      name: enMessages.chat.assistantModelSelector.label,
    });
    expect(group).toContainElement(screen.getByTestId('agent-selector-stub'));
    expect(group).toContainElement(screen.getByTestId('model-selector-stub'));
  });
});
