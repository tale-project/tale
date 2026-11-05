/**
 * The composer's agent control by keyboard: the menu opens with the focus
 * on who answers now, the arrow keys move through the choices, and Enter
 * picks one and closes the menu.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ChatAgentChoice } from '@/app/lib/backend/contract/projects';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ComposerAgentPicker } from './composer-agent-picker';

const agent = (id: string, name: string): ChatAgentChoice => ({
  id,
  name,
  model: 'chat-model',
  modelProvider: null,
  skills: [],
  createdAt: 1,
});

const AGENTS = [agent('a1', 'Copy reviewer'), agent('a2', 'Coder')];

describe('choosing who answers by keyboard [CHAT-R43]', () => {
  it('opens on the current choice, moves with the arrows and picks with Enter', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ComposerAgentPicker
        agents={AGENTS}
        agentId="a1"
        defaultAgentId="a1"
        modelLabel={() => 'Chat Model'}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Who answers: Copy reviewer. Change who answers',
    });
    trigger.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(
        screen.getByRole('menuitemradio', { name: 'Copy reviewer, Default' }),
      ).toHaveFocus();
    });
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Coder' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('a2');
    await waitFor(() => {
      expect(screen.queryByRole('menuitemradio')).toBeNull();
    });
  });
});
