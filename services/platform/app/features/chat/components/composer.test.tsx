// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type {
  ComposerModelOption,
  ComposerSandboxAgentOption,
  ComposerSelection,
} from '../types';
import { Composer } from './composer';
import { resolveSelectionSandbox } from './composer-model-picker';

const API_KEY_MODEL: ComposerModelOption = {
  id: 'anthropic/claude-fable-5',
  label: 'Claude Fable 5',
  providerSlug: 'openrouter',
  credential: { authMethod: 'api-key' },
};

const SUBSCRIPTION_MODEL: ComposerModelOption = {
  id: 'anthropic/claude-fable-5-max',
  label: 'Claude Fable 5 (Max plan)',
  providerSlug: 'anthropic',
  credential: {
    authMethod: 'subscription-key',
    constraints: { execution: 'sandbox', harness: 'claude-code' },
  },
};

const CODING_AGENTS: ComposerSandboxAgentOption[] = [
  { harness: 'claude-code', label: 'Claude Code' },
  { harness: 'codex', label: 'Codex' },
];

const PLATFORM: ComposerSelection = {
  agentKind: 'platform',
  voiceOutput: false,
};

/** Renders the composer with real selection state so picks stick. */
function renderComposer({
  models = [API_KEY_MODEL],
  sandboxAgents = CODING_AGENTS,
  initial = PLATFORM,
  onSend = vi.fn(),
  generating = false,
  sendDisabled = false,
}: {
  models?: ComposerModelOption[];
  sandboxAgents?: ComposerSandboxAgentOption[];
  initial?: ComposerSelection;
  onSend?: (text: string) => void;
  generating?: boolean;
  sendDisabled?: boolean;
} = {}) {
  const seen: ComposerSelection[] = [];

  function Harness() {
    const [selection, setSelection] = useState(initial);
    seen.push(selection);
    return (
      <Composer
        models={models}
        sandboxAgents={sandboxAgents}
        selection={selection}
        onSelectionChange={setSelection}
        onSend={onSend}
        generating={generating}
        sendDisabled={sendDisabled}
      />
    );
  }

  return { ...render(<Harness />), selection: () => seen[seen.length - 1] };
}

describe('Composer agent picker', () => {
  it('groups the menu into the platform agent and third-party agents', async () => {
    const { user } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Select agent' }));

    expect(screen.getByText('Platform agent')).toBeInTheDocument();
    expect(
      screen.getByText('Third-party agents · run in a sandbox'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Assistant' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Claude Code' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument();
  });

  it('picking a coding agent switches the kind and keeps the platform model for the way back', async () => {
    const { user, selection } = renderComposer({
      initial: { ...PLATFORM, modelId: API_KEY_MODEL.id },
    });

    await user.click(screen.getByRole('button', { name: 'Select agent' }));
    await user.click(screen.getByRole('menuitem', { name: 'Codex' }));

    expect(selection()).toMatchObject({
      agentKind: 'coding',
      harness: 'codex',
      // Held, not dropped: returning to the platform agent returns to it.
      modelId: API_KEY_MODEL.id,
    });
  });

  it('shows no model picker for a coding agent, but a plain-word hint', () => {
    renderComposer({
      initial: { agentKind: 'coding', harness: 'codex', voiceOutput: false },
    });

    expect(screen.queryByRole('button', { name: 'Select model' })).toBeNull();
    expect(
      screen.getByText("This coding agent isn't wired to chat yet."),
    ).toBeInTheDocument();
  });

  it('returns to the platform agent and its model picker', async () => {
    const { user, selection } = renderComposer({
      initial: { agentKind: 'coding', harness: 'codex', voiceOutput: false },
    });

    await user.click(screen.getByRole('button', { name: 'Select agent' }));
    await user.click(screen.getByRole('menuitem', { name: 'Assistant' }));

    expect(selection()).toMatchObject({ agentKind: 'platform' });
    expect(selection().harness).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toBeInTheDocument();
  });
});

describe('Composer model picker', () => {
  it('lists only models — no harness entries and no automatic entry', async () => {
    const { user } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
    });

    await user.click(screen.getByRole('button', { name: 'Select model' }));

    expect(
      screen.getByRole('menuitem', { name: API_KEY_MODEL.label }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Claude Code' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^auto$/i })).toBeNull();
  });

  it('picking a model keeps the platform kind', async () => {
    const { user, selection } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
    });

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    await user.click(
      screen.getByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    );

    expect(selection()).toMatchObject({
      agentKind: 'platform',
      modelId: SUBSCRIPTION_MODEL.id,
    });
  });
});

describe('resolveSelectionSandbox', () => {
  it('runs a coding agent in a sandbox, always', () => {
    expect(
      resolveSelectionSandbox(
        { agentKind: 'coding', harness: 'codex', voiceOutput: false },
        [API_KEY_MODEL],
      ),
    ).toBe(true);
  });

  it('runs a platform key-served model directly', () => {
    expect(
      resolveSelectionSandbox({ ...PLATFORM, modelId: API_KEY_MODEL.id }, [
        API_KEY_MODEL,
      ]),
    ).toBe(false);
  });

  it('sends a subscription-bound model to its sandbox', () => {
    expect(
      resolveSelectionSandbox({ ...PLATFORM, modelId: SUBSCRIPTION_MODEL.id }, [
        SUBSCRIPTION_MODEL,
      ]),
    ).toBe(true);
  });

  it('renders no sandbox switch — where a turn runs is the agent kind', () => {
    renderComposer();

    expect(screen.queryByRole('switch', { name: 'Sandbox' })).toBeNull();
  });
});

describe('Composer mode menu', () => {
  it('offers reading replies aloud as a mode, and no harness mode', async () => {
    const { user } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Open chat menu' }));

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Read replies aloud' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Claude Code', { selector: '[role^="menuitem"]' }),
    ).toBeNull();
  });

  it('turns reading replies aloud on for the message being sent', async () => {
    const { user, selection } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Open chat menu' }));
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Read replies aloud' }),
    );

    expect(selection().voiceOutput).toBe(true);
  });
});

describe('Composer sending', () => {
  it('sends on Enter and clears the field', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({ onSend });

    const field = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(field, 'hello there{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello there');
    expect(field).toHaveValue('');
  });

  it('keeps an empty message unsendable', () => {
    renderComposer();

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('offers stop instead of send while a turn is in flight', () => {
    renderComposer({ generating: true });

    expect(
      screen.getByRole('button', { name: 'Stop generating' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  });
});

describe('Composer accessibility', () => {
  it('passes an axe audit', async () => {
    const { container } = renderComposer();
    await waitFor(() => checkAccessibility(container));
  });

  it('names every control', () => {
    renderComposer();

    expect(
      screen.getByRole('button', { name: 'Open chat menu' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Select agent' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeInTheDocument();
  });

  it('invites a pick when options exist and nothing is selected', () => {
    renderComposer();

    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toHaveTextContent('Select model');
  });

  it('claims no models only when the menu is truly empty', () => {
    renderComposer({ models: [] });

    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toHaveTextContent('No models available');
  });

  it('blocks only the send button under sendDisabled, keeping the rest usable', async () => {
    const { user } = renderComposer({ sendDisabled: true });

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'Hi',
    );

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
  });
});
