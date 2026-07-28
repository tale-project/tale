// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

// The footer subscribes to the org's data-classification notice through the
// live Convex client, which these component tests do not mount. The marker
// keeps its presence assertable without the backend.
vi.mock('@/app/features/governance/components/data-notice-footer', () => ({
  DataNoticeFooter: () => <div data-testid="data-notice-footer" />,
}));

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type {
  ComposerCapabilityOption,
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

const SKILLS: ComposerCapabilityOption[] = [
  { slug: 'visual-aspect-analyzer', label: 'visual-aspect-analyzer' },
];

const CONNECTORS: ComposerCapabilityOption[] = [
  { slug: 'slack', label: 'Slack' },
];

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
  skills?: ComposerCapabilityOption[];
  connectors?: ComposerCapabilityOption[];
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

    await user.click(screen.getByRole('button', { name: 'Select agent' }));

    expect(screen.getByText('Agents · run in a sandbox')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Chat' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Claude Code' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument();
  });

  it('picking an external agent switches the kind and keeps the platform model for the way back', async () => {
    const { user, selection } = renderComposer({
      initial: { ...PLATFORM, modelId: API_KEY_MODEL.id },
    });

    await user.click(screen.getByRole('button', { name: 'Select agent' }));
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

    // The trigger displays the model the turn WOULD use — the first
    // direct-served one, never the subscription-bound entry.
    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toHaveTextContent(API_KEY_MODEL.label);
    expect(
      screen.getByRole('button', { name: 'Capabilities' }),
    ).toBeInTheDocument();
  });

  it('returns to the platform agent and its model picker', async () => {
    const { user, selection } = renderComposer({ initial: EXTERNAL });

    await user.click(screen.getByRole('button', { name: 'Select agent' }));
    await user.click(screen.getByRole('menuitem', { name: 'Chat' }));

    expect(selection()).toMatchObject({ agentKind: 'platform' });
    expect(selection().harness).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Select model' }),
    ).toBeInTheDocument();
  });
});

describe('Composer capability assembly', () => {
  it('offers skills and connectors to an external agent, and toggles stick', async () => {
    const { user, selection } = renderComposer({ initial: EXTERNAL });

    await user.click(screen.getByRole('button', { name: 'Capabilities' }));

    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Connectors')).toBeInTheDocument();

    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'visual-aspect-analyzer' }),
    );
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Slack' }));

    expect(selection().skills).toEqual(['visual-aspect-analyzer']);
    expect(selection().connectors).toEqual(['slack']);

    // Unchecking removes; the other pick is untouched.
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'visual-aspect-analyzer' }),
    );
    expect(selection().skills).toEqual([]);
    expect(selection().connectors).toEqual(['slack']);
  });

  it('counts the assembly on the trigger', async () => {
    const { user } = renderComposer({
      initial: { ...EXTERNAL, skills: ['visual-aspect-analyzer'] },
    });

    expect(
      screen.getByRole('button', { name: 'Capabilities' }),
    ).toHaveTextContent('Capabilities (1)');
    await user.click(screen.getByRole('button', { name: 'Capabilities' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'visual-aspect-analyzer' }),
    ).toBeChecked();
  });

  it('shows both groups when empty, each stating why it is empty', async () => {
    const { user } = renderComposer({
      initial: EXTERNAL,
      skills: [],
      connectors: [],
    });

    await user.click(screen.getByRole('button', { name: 'Capabilities' }));

    // Skills stage into the session, so their group shows even when empty.
    expect(
      screen.getByText('No skills in this organization yet.'),
    ).toBeInTheDocument();
    // Connectors are credential-gated: an org with none sees WHERE to add one
    // instead of a silently missing group (which reads as a bug, not as
    // "nothing to equip").
    expect(screen.getByText(/No connectors enabled yet/)).toBeInTheDocument();
  });

  it('offers no capability menu to the platform agent — that lane comes with the tool loop', () => {
    renderComposer();

    expect(screen.queryByRole('button', { name: 'Capabilities' })).toBeNull();
  });
});

describe('Composer model picker', () => {
  it('lists only direct-served models — no subscription, harness, or auto entries', async () => {
    const { user } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
    });

    await user.click(screen.getByRole('button', { name: 'Select model' }));

    expect(
      screen.getByRole('menuitem', { name: API_KEY_MODEL.label }),
    ).toBeInTheDocument();
    // A subscription model has no direct path — it belongs to its vendor's
    // harness lane, so the platform picker never offers a dead end.
    expect(
      screen.queryByRole('menuitem', { name: SUBSCRIPTION_MODEL.label }),
    ).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Claude Code' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^auto$/i })).toBeNull();
  });

  it('picking a model keeps the platform kind', async () => {
    const { user, selection } = renderComposer({
      models: [API_KEY_MODEL, SUBSCRIPTION_MODEL],
    });

    await user.click(screen.getByRole('button', { name: 'Select model' }));
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

    await user.click(screen.getByRole('button', { name: 'Select model' }));

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

    await user.click(screen.getByRole('button', { name: 'Select model' }));
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
      screen.getByRole('button', { name: 'Select model' }),
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

  it('carries the data notice under the field', () => {
    renderComposer();
    expect(screen.getByTestId('data-notice-footer')).toBeInTheDocument();
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

describe('Composer slash command', () => {
  const SLASH_SKILLS: ComposerCapabilityOption[] = [
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
