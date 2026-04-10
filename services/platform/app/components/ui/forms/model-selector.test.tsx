import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { ModelSelector } from './model-selector';

vi.mock('framer-motion', () => {
  const Item = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  const Group = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;

  return {
    Reorder: { Group, Item },
    useDragControls: () => ({ start: vi.fn() }),
  };
});

const defaultModels = ['anthropic/claude-sonnet-4', 'openai/gpt-4o'];

const availableOptions = [
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
];

const displayNames: Record<string, string> = {
  'anthropic/claude-sonnet-4': 'Claude Sonnet 4',
  'openai/gpt-4o': 'GPT-4o',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'openai/gpt-4o-mini': 'GPT-4o Mini',
};

function getDisplayName(modelId: string): string {
  return displayNames[modelId] ?? modelId;
}

function renderModelSelector(
  props: Partial<React.ComponentProps<typeof ModelSelector>> = {},
) {
  const onChange = vi.fn();
  const result = render(
    <ModelSelector
      models={defaultModels}
      onChange={onChange}
      availableOptions={availableOptions}
      getDisplayName={getDisplayName}
      {...props}
    />,
  );
  return { ...result, onChange };
}

describe('ModelSelector', () => {
  describe('rendering', () => {
    it('renders all model display names', () => {
      renderModelSelector();
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument();
      expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    });

    it('renders add model button', () => {
      renderModelSelector();
      expect(screen.getByText('Add model')).toBeInTheDocument();
    });

    it('renders reorder controls when not readonly', () => {
      renderModelSelector();
      const moveUpButtons = screen.getAllByLabelText(/move.*up/i);
      expect(moveUpButtons.length).toBeGreaterThan(0);
    });

    it('hides reorder controls when readonlyOrder', () => {
      renderModelSelector({ readonlyOrder: true });
      expect(screen.queryByLabelText(/move.*up/i)).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onChange when adding a model', async () => {
      const { user, onChange } = renderModelSelector();
      await user.click(screen.getByText('Add model'));
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/Search models/i),
        ).toBeInTheDocument();
      });
      await user.click(screen.getByText('Gemini 2.5 Pro'));
      expect(onChange).toHaveBeenCalledWith([
        'anthropic/claude-sonnet-4',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ]);
    });

    it('calls onChange when removing a model', async () => {
      const { user, onChange } = renderModelSelector();
      const removeButtons = screen.getAllByLabelText(/Remove/i);
      await user.click(removeButtons[0]);
      expect(onChange).toHaveBeenCalledWith(['openai/gpt-4o']);
    });

    it('does not remove when at minModels', async () => {
      const { user, onChange } = renderModelSelector({
        models: ['anthropic/claude-sonnet-4'],
        minModels: 1,
      });
      const removeButtons = screen.getAllByLabelText(/Remove/i);
      await user.click(removeButtons[0]);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('reordering', () => {
    it('calls onChange with swapped order on move down', async () => {
      const { user, onChange } = renderModelSelector();
      const moveDownButtons = screen.getAllByLabelText(/move.*down/i);
      await user.click(moveDownButtons[0]);
      expect(onChange).toHaveBeenCalledWith([
        'openai/gpt-4o',
        'anthropic/claude-sonnet-4',
      ]);
    });

    it('calls onChange with swapped order on move up', async () => {
      const { user, onChange } = renderModelSelector();
      const moveUpButtons = screen.getAllByLabelText(/move.*up/i);
      // Click move up on the second item
      await user.click(moveUpButtons[1]);
      expect(onChange).toHaveBeenCalledWith([
        'openai/gpt-4o',
        'anthropic/claude-sonnet-4',
      ]);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = renderModelSelector();
      await checkAccessibility(container);
    });

    it('passes axe audit in readonly mode', async () => {
      const { container } = renderModelSelector({ readonlyOrder: true });
      await checkAccessibility(container);
    });
  });
});
