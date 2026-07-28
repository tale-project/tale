// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type {
  ComposerSkillOption,
  ComposerModelOption,
  ComposerExternalAgentOption,
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

const EXTERNAL_AGENTS: ComposerExternalAgentOption[] = [
  { harness: 'claude-code', label: 'Claude Code' },
  { harness: 'codex', label: 'Codex' },
];

const PLATFORM: ComposerSelection = {
  agentKind: 'platform',
  skills: [],
  connectors: [],
};

const EXTERNAL: ComposerSelection = {
  agentKind: 'external',
  harness: 'codex',
  skills: [],
  connectors: [],
};

const SKILLS: ComposerSkillOption[] = [
  { slug: 'visual-aspect-analyzer', label: 'visual-aspect-analyzer' },
];

const CONNECTORS: ComposerSkillOption[] = [{ slug: 'slack', label: 'Slack' }];

/** Renders the composer with real selection state so picks stick. */
function renderComposer({
  models = [API_KEY_MODEL],
  externalAgents = EXTERNAL_AGENTS,
  skills = SKILLS,
  connectors = CONNECTORS,
  initial = PLATFORM,
  onSend = vi.fn(),
  generating = false,
  sendDisabled = false,
  onVoiceOutputChange = vi.fn(),
}: {
  models?: ComposerModelOption[];
  externalAgents?: ComposerExternalAgentOption[];
  skills?: ComposerSkillOption[];
  connectors?: ComposerSkillOption[];
  initial?: ComposerSelection;
  onSend?: (text: string) => void;
  generating?: boolean;
  sendDisabled?: boolean;
  onVoiceOutputChange?: (next: boolean) => void;
} = {}) {
  const seen: ComposerSelection[] = [];

  function Harness() {
    const [selection, setSelection] = useState(initial);
    seen.push(selection);
    return (
      <Composer
        models={models}
        externalAgents={externalAgents}
        skills={skills}
        connectors={connectors}
        selection={selection}
        onSelectionChange={setSelection}
        onSend={onSend}
        generating={generating}
        sendDisabled={sendDisabled}
        voiceOutput={false}
        onVoiceOutputChange={onVoiceOutputChange}
      />
    );
  }

  return { ...render(<Harness />), selection: () => seen[seen.length - 1] };
}

describe('Composer agent picker', () => {
  it('groups the menu into the chat entry and sandboxed agents', async () => {
    const { user } = renderComposer();

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );

    expect(screen.getByText('Agents · run in a sandbox')).toBeInTheDocument();
    // Platform mode lists the models directly — picking one IS picking the
    // Chat agent, so there is no separate "Chat" row to click.
    expect(
      screen.getByRole('menuitem', { name: API_KEY_MODEL.label }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Claude Code' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument();
  });

  it('picking an external agent switches the kind and keeps the platform model for the way back', async () => {
    const { user, selection } = renderComposer({
      initial: { ...PLATFORM, modelId: API_KEY_MODEL.id },
    });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Codex' }));

    expect(selection()).toMatchObject({
      agentKind: 'external',
      harness: 'codex',
      // Held, not dropped: returning to the platform agent returns to it.
      modelId: API_KEY_MODEL.id,
    });
  });

  it('shows the model picker beside the capability assembly for an external agent', () => {
    renderComposer({
      initial: EXTERNAL,
      models: [SUBSCRIPTION_MODEL, API_KEY_MODEL],
    });

    // The trigger names the agent and, as its suffix, the model the turn
    // WOULD use — the first direct-served one, never the subscription-bound
    // entry.
    const trigger = screen.getByRole('button', {
      name: 'Choose agent, model, and effort',
    });
    expect(trigger).toHaveTextContent('Codex');
    expect(trigger).toHaveTextContent(API_KEY_MODEL.label);
  });

  it('returns to the platform agent and its model picker', async () => {
    const { user, selection } = renderComposer({ initial: EXTERNAL });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Chat' }));

    expect(selection()).toMatchObject({ agentKind: 'platform' });
    expect(selection().harness).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toBeInTheDocument();
  });
});

describe('Composer skill assembly', () => {
  const openSub = async (
    user: ReturnType<typeof renderComposer>['user'],
    name: RegExp,
  ) => {
    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );
    // The pick count trails inside the row, so it concatenates into the
    // accessible name ("Skills1") — match by prefix.
    await user.click(screen.getByRole('menuitem', { name }));
  };

  it('offers skills and connectors to an external agent, and toggles stick', async () => {
    const { user, selection } = renderComposer({ initial: EXTERNAL });

    await openSub(user, /^Skills/);
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', {
        name: 'visual-aspect-analyzer',
      }),
    );
    expect(selection().skills).toEqual(['visual-aspect-analyzer']);

    await user.click(screen.getByRole('menuitem', { name: /^Connectors/ }));
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Slack' }),
    );
    expect(selection().connectors).toEqual(['slack']);

    // Unchecking removes; the other pick is untouched.
    await user.click(screen.getByRole('menuitem', { name: /^Skills/ }));
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', {
        name: 'visual-aspect-analyzer',
      }),
    );
    expect(selection().skills).toEqual([]);
    expect(selection().connectors).toEqual(['slack']);
  });

  it('offers the same assembly to the platform agent', async () => {
    const { user, selection } = renderComposer();

    await openSub(user, /^Skills/);
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', {
        name: 'visual-aspect-analyzer',
      }),
    );

    expect(selection()).toMatchObject({
      agentKind: 'platform',
      skills: ['visual-aspect-analyzer'],
    });
  });

  it('counts the picks on the submenu rows', async () => {
    const { user } = renderComposer({
      initial: { ...EXTERNAL, skills: ['visual-aspect-analyzer'] },
    });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );
    expect(screen.getByRole('menuitem', { name: /Skills/ })).toHaveTextContent(
      '1',
    );
  });

  it('shows both groups when empty, each stating why it is empty', async () => {
    const { user } = renderComposer({
      initial: EXTERNAL,
      skills: [],
      connectors: [],
    });

    await openSub(user, /^Skills/);
    // Skills stage into the session, so their group shows even when empty.
    expect(
      await screen.findByText('No skills in this organization yet.'),
    ).toBeInTheDocument();
    // Connectors are credential-gated: an org with none sees WHERE to add one
    // instead of a silently missing group.
    await user.click(screen.getByRole('menuitem', { name: /^Connectors/ }));
    expect(
      await screen.findByText(/No connectors enabled yet/),
    ).toBeInTheDocument();
  });
});

describe('Composer model picker', () => {
  it('lists only direct-served models — no subscription, harness, or auto entries', async () => {
    const { user } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
    });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );

    expect(
      screen.getByRole('menuitem', { name: API_KEY_MODEL.label }),
    ).toBeInTheDocument();
    // A subscription model has no direct path — it belongs to its vendor's
    // harness lane, so the platform picker never offers a dead end. The
    // harness itself appears, but as an AGENT under its own section — never
    // masquerading as a pickable platform model.
    expect(
      screen.queryByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Claude Code' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Agents · run in a sandbox')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^auto$/i })).toBeNull();
  });

  it('picking a model keeps the platform kind', async () => {
    const { user, selection } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
    });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: API_KEY_MODEL.label }),
    );

    expect(selection()).toMatchObject({
      agentKind: 'platform',
      modelId: API_KEY_MODEL.id,
    });
  });

  it('narrows the external lane to direct-served models, and a pick sticks', async () => {
    const secondDirect: ComposerModelOption = {
      id: 'zai/glm-5',
      label: 'GLM-5',
      providerSlug: 'zai',
      credential: { authMethod: 'env' },
    };
    const { user, selection } = renderComposer({
      initial: EXTERNAL,
      models: [SUBSCRIPTION_MODEL, API_KEY_MODEL, secondDirect],
    });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );

    // A subscription-bound model only runs in its own vendor's tooling — the
    // external lane never offers it.
    expect(
      screen.queryByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    ).toBeNull();

    await user.click(
      screen.getByRole('menuitem', { name: secondDirect.label }),
    );

    expect(selection()).toMatchObject({
      agentKind: 'external',
      harness: 'codex',
      modelId: secondDirect.id,
    });
  });

  it('offers a vendor-subscription model to exactly its own harness, and a pick sticks', async () => {
    const { user, selection } = renderComposer({
      initial: { ...EXTERNAL, harness: 'claude-code' },
      models: [SUBSCRIPTION_MODEL, API_KEY_MODEL],
    });

    await user.click(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    );

    expect(selection()).toMatchObject({
      agentKind: 'external',
      harness: 'claude-code',
      modelId: SUBSCRIPTION_MODEL.id,
      providerSlug: SUBSCRIPTION_MODEL.providerSlug,
    });
  });

  it('claims no models for an external agent when nothing is direct-served', () => {
    renderComposer({ initial: EXTERNAL, models: [SUBSCRIPTION_MODEL] });

    expect(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toHaveTextContent('No models available');
  });
});

describe('resolveSelectionSandbox', () => {
  it('runs an external agent in a sandbox, always', () => {
    expect(resolveSelectionSandbox(EXTERNAL, [API_KEY_MODEL])).toBe(true);
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

  it('reports the read-replies-aloud toggle to its server-backed owner', async () => {
    const onVoiceOutputChange = vi.fn();
    const { user } = renderComposer({ onVoiceOutputChange });

    await user.click(screen.getByRole('button', { name: 'Open chat menu' }));
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Read replies aloud' }),
    );

    expect(onVoiceOutputChange).toHaveBeenCalledWith(true);
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
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeInTheDocument();
  });

  it('invites a pick when options exist and nothing is selected', () => {
    renderComposer();

    expect(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toHaveTextContent('Select model');
  });

  it('claims no models only when the menu is truly empty', () => {
    renderComposer({ models: [] });

    expect(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toHaveTextContent('No models available');
  });

  it('blocks only the send button under sendDisabled, keeping the rest usable', async () => {
    const { user } = renderComposer({ sendDisabled: true });

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'Hi',
    );

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Choose agent, model, and effort' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
  });
});

describe('Composer slash command', () => {
  const SLASH_SKILLS: ComposerSkillOption[] = [
    { slug: 'pdf', label: 'pdf', description: 'Work with PDFs' },
    { slug: 'write-docs', label: 'write-docs' },
    { slug: 'agent-only', label: 'agent-only', usageMode: 'agent' },
  ];

  it('opens a listbox of chat-usable skills when the message starts with /', async () => {
    const { user } = renderComposer({ skills: SLASH_SKILLS });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    await user.type(field, '/');

    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('/pdf'),
      expect.stringContaining('/write-docs'),
    ]);
    // The field takes the combobox contract only while the menu is open.
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-controls',
      listbox.id,
    );
  });

  it('completes the highlighted skill on Enter without sending', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({ skills: SLASH_SKILLS, onSend });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    await user.type(field, '/w');
    await user.keyboard('{Enter}');

    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('/write-docs ');
    // The token is complete, so the menu is gone and Enter sends again.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape and sends the raw text verbatim', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({ skills: SLASH_SKILLS, onSend });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    await user.type(field, '/p');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Typing on re-arms the menu; the space after the token retires it for
    // good, so Enter is a plain send of exactly what was typed.
    await user.type(field, 'df extract the tables');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('/pdf extract the tables');
  });

  it('never opens mid-text', async () => {
    const { user } = renderComposer({ skills: SLASH_SKILLS });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    await user.type(field, 'see /pdf');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
