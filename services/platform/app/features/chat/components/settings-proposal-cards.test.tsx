/**
 * The changes to projects and agents a reply proposed, as cards under it:
 * field by field, with Apply and Dismiss for the chat's owner only, and
 * what became of each after a decision.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatProposalView } from '@/lib/chat/settings-tools';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import {
  ChatProposalDecisionContext,
  proposalIdsOf,
  SettingsProposalCards,
} from './settings-proposal-cards';

const { proposals, decide, toast } = vi.hoisted(() => ({
  proposals: {
    current: { status: 'ready', data: [] } as
      | { status: 'ready'; data: ChatProposalView[] }
      | { status: 'unavailable' },
  },
  decide: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../data/chat-backend', () => ({
  useChatProposals: () => proposals.current,
  useProposalDecision: () => ({ decide }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
}));

const NEW_AGENT: ChatProposalView = {
  id: 'proposal-1',
  kind: 'create_agent',
  status: 'pending',
  projectId: 'project-1',
  projectName: 'Website relaunch',
  agentName: 'Proofreader',
  fields: [
    { field: 'name', value: 'Proofreader' },
    { field: 'model', value: 'Chat Model · Gateway' },
    { field: 'runtime', value: 'Claude Code' },
    { field: 'instructions', value: 'Check spelling and grammar.' },
  ],
  createdAt: 1,
};

const RENAME: ChatProposalView = {
  id: 'proposal-2',
  kind: 'update_agent',
  status: 'pending',
  projectId: 'project-1',
  projectName: 'Website relaunch',
  agentId: 'agent-1',
  agentName: 'Copy reviewer',
  fields: [
    { field: 'name', value: 'Copy editor', before: 'Copy reviewer' },
    { field: 'skills', value: '', before: 'docx' },
  ],
  createdAt: 2,
};

const DEFAULT_AGENT: ChatProposalView = {
  id: 'proposal-3',
  kind: 'update_project',
  status: 'pending',
  projectId: 'project-1',
  projectName: 'Website relaunch',
  fields: [
    {
      field: 'defaultChatAgent',
      // The model's words; the card says it in the reader's.
      value: 'model words',
      before: 'model words before',
      chatAgent: { kind: 'assistant' },
      chatAgentBefore: { kind: 'first', name: 'Copy reviewer' },
    },
  ],
  createdAt: 3,
};

const proposed = (proposalId: string): MessagePart => ({
  type: 'tool-result',
  callId: `call-${proposalId}`,
  capabilityId: 'propose_project_settings',
  output: { status: 'ok', proposalId },
  structured: false,
});

function renderCards(
  parts: readonly MessagePart[],
  { canDecide = true }: { canDecide?: boolean } = {},
) {
  return render(
    <ChatProposalDecisionContext.Provider value={canDecide}>
      <SettingsProposalCards
        parts={parts}
        organizationId="org_1"
        threadId="thread-1"
      />
    </ChatProposalDecisionContext.Provider>,
  );
}

beforeEach(() => {
  proposals.current = { status: 'ready', data: [NEW_AGENT, RENAME] };
  decide.mockReset();
  toast.mockReset();
});

describe('a proposed change under a reply [CHAT-R44]', () => {
  it('shows the new agent field by field, with Apply and Dismiss for the chat’s owner', async () => {
    const view = renderCards([proposed('proposal-1')]);
    const card = screen.getByRole('region', {
      name: 'New agent in Website relaunch',
    });
    expect(card).toHaveTextContent('Proposed');
    expect(card).toHaveTextContent('Proofreader');
    expect(card).toHaveTextContent('Claude Code');
    expect(card).toHaveTextContent('Check spelling and grammar.');
    expect(card).toHaveTextContent('Nothing changes until you apply it.');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
    await checkAccessibility(view);
  });

  it('applied, shows the outcome and opens the project’s agents', async () => {
    decide.mockResolvedValue({
      ...NEW_AGENT,
      status: 'applied',
      agentId: 'agent-9',
      decidedAt: 3,
    });
    const { user } = renderCards([proposed('proposal-1')]);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: "Open the project's agents" }),
      ).toBeInTheDocument();
    });
    expect(decide).toHaveBeenCalledWith('proposal-1', 'apply');
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    // The buttons are gone; the focus they held is on the card, not lost.
    await waitFor(() => {
      expect(
        screen.getByRole('region', { name: 'New agent in Website relaunch' }),
      ).toHaveFocus();
    });
  });

  it('shows a reader of a shared chat the card without its buttons', () => {
    renderCards([proposed('proposal-1')], { canDecide: false });
    expect(
      screen.getByRole('region', { name: 'New agent in Website relaunch' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('shows a change as what it was and what it becomes', () => {
    renderCards([proposed('proposal-2')]);
    const card = screen.getByRole('region', {
      name: 'Change agent Copy reviewer',
    });
    expect(card).toHaveTextContent('Copy reviewer');
    expect(card).toHaveTextContent('Copy editor');
    // An agent left without skills reads as none, not as a blank.
    expect(card).toHaveTextContent('(none)');
  });

  it('names who answers in new chats in the reader’s words, before and after', () => {
    proposals.current = { status: 'ready', data: [DEFAULT_AGENT] };
    renderCards([proposed('proposal-3')]);
    const card = screen.getByRole('region', {
      name: 'Change project Website relaunch',
    });
    expect(card).toHaveTextContent('First agent created (Copy reviewer)');
    expect(card).toHaveTextContent('Assistant');
    expect(card).not.toHaveTextContent('model words');
  });

  it('is read with its status, so a decision that moves the focus to it is heard', () => {
    renderCards([proposed('proposal-1')]);
    expect(
      screen.getByRole('region', { name: 'New agent in Website relaunch' }),
    ).toHaveAccessibleDescription('Proposed');
  });

  it('says so when the proposals cannot be read', () => {
    proposals.current = { status: 'unavailable' };
    renderCards([proposed('proposal-1')]);
    expect(
      screen.getByText(
        "The proposed change couldn't be loaded. Reload the page to see it.",
      ),
    ).toBeInTheDocument();
  });

  it('reads only the proposals a reply made', () => {
    expect(
      proposalIdsOf([
        proposed('proposal-1'),
        {
          type: 'tool-result',
          callId: 'call-x',
          capabilityId: 'propose_project_settings',
          output: { status: 'invalid_args', message: 'No such project.' },
          structured: false,
        },
        {
          type: 'tool-result',
          callId: 'call-y',
          capabilityId: 'create_file',
          output: { status: 'ok', proposalId: 'not-a-proposal' },
          structured: false,
        },
      ]),
    ).toEqual(['proposal-1']);
  });
});

describe('a proposal whose subject changed since [CHAT-R46]', () => {
  it('says on the card why it was not applied, and that it was not', async () => {
    decide.mockResolvedValue({
      ...RENAME,
      status: 'failed',
      failure: { code: 'PROJECT_AGENT_STALE', reason: 'stale' },
      decidedAt: 3,
    });
    const { user } = renderCards([proposed('proposal-2')]);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(screen.getByText('Not applied')).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'This changed since the proposal was made. Ask the chat for a new proposal.',
      ),
    ).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith({
      title: "The change wasn't applied",
      variant: 'destructive',
    });
  });
});
