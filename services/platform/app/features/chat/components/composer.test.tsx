// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type {
  ChatAgentOption,
  ComposerModelOption,
  ComposerSandboxAgentOption,
  ComposerSelection,
} from '../types';
import { Composer } from './composer';

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

const SANDBOX_AGENTS: ComposerSandboxAgentOption[] = [
  { harness: 'claude-code', label: 'Claude Code' },
  { harness: 'codex', label: 'Codex' },
];

const AGENTS: ChatAgentOption[] = [
  { slug: 'assistant', label: 'Assistant' },
  { slug: 'researcher', label: 'Researcher' },
];

/** Renders the composer with real selection state so picks stick. */
function renderComposer({
  models = [API_KEY_MODEL],
  sandboxAgents = SANDBOX_AGENTS,
  agents = AGENTS,
  initial = { sandbox: false, voiceOutput: false } as ComposerSelection,
  onSend = vi.fn(),
  generating = false,
  sendDisabled = false,
}: {
  models?: ComposerModelOption[];
  sandboxAgents?: ComposerSandboxAgentOption[];
  agents?: ChatAgentOption[];
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
        agents={agents}
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

describe('Composer model picker', () => {
  it('groups the menu into Models and Sandbox agents, with no automatic entry', async () => {
    const { user } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Select model' }));

    expect(screen.getByText('Models')).toBeInTheDocument();
    expect(screen.getByText('Sandbox agents')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^auto$/i })).toBeNull();
  });

  it('lists the sandbox agents under their own group', async () => {
    const { user } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Select model' }));

    expect(
      screen.getByRole('menuitem', { name: 'Claude Code' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument();
  });

  it('picking a sandbox agent runs the turn in a sandbox', async () => {
    const { user, selection } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    await user.click(screen.getByRole('menuitem', { name: 'Codex' }));

    expect(selection()).toMatchObject({ harness: 'codex', sandbox: true });
  });
});

describe('Composer sandbox toggle', () => {
  it('leaves the toggle free for a model the platform holds a key for', async () => {
    const { user, selection } = renderComposer({
      initial: {
        modelId: API_KEY_MODEL.id,
        sandbox: false,
        voiceOutput: false,
      },
    });

    const toggle = screen.getByRole('switch', { name: 'Sandbox' });
    expect(toggle).toBeEnabled();

    await user.click(toggle);
    expect(selection().sandbox).toBe(true);
  });

  it('locks the toggle on and names the harness when the credential forces it', () => {
    renderComposer({
      models: [SUBSCRIPTION_MODEL],
      initial: {
        modelId: SUBSCRIPTION_MODEL.id,
        sandbox: true,
        voiceOutput: false,
      },
    });

    const toggle = screen.getByRole('switch', { name: 'Sandbox' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(/only runs in a sandbox, on claude-code/i),
    ).toBeInTheDocument();
  });

  it('takes the toggle with it when a forced model is picked', async () => {
    const { user, selection } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
      initial: {
        modelId: API_KEY_MODEL.id,
        sandbox: false,
        voiceOutput: false,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    await user.click(
      screen.getByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    );

    expect(selection().sandbox).toBe(true);
  });

  it('offers no toggle for a sandbox agent — it is already the sandbox', () => {
    renderComposer({
      initial: { harness: 'codex', sandbox: true, voiceOutput: false },
    });

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
    renderComposer({ models: [], sandboxAgents: [] });

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
