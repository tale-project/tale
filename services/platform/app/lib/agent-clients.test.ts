import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { OpenAIIcon } from '@tale/ui/icons/openai-icon';
import { Bot } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { agentClientMark } from './agent-clients';

describe('the mark an app is shown with', () => {
  it('is a vendor’s own icon for a host Tale verified', () => {
    expect(agentClientMark('claude.ai')).toBe(ClaudeIcon);
    expect(agentClientMark('claude.com')).toBe(ClaudeIcon);
    expect(agentClientMark('chatgpt.com')).toBe(OpenAIIcon);
    expect(agentClientMark('openai.com')).toBe(OpenAIIcon);
  });

  it('is the neutral glyph for an app nobody verified, and for a host that is not a vendor’s', () => {
    expect(agentClientMark(null)).toBe(Bot);
    expect(agentClientMark('agent.example.test')).toBe(Bot);
  });

  it('is the neutral glyph for a host that only looks like a vendor’s: another owner of a subdomain, a longer name', () => {
    for (const host of [
      'evil.claude.ai',
      'claude.ai.evil.example',
      'notclaude.ai',
      'Claude.ai',
      'claude.ai.',
    ]) {
      expect(agentClientMark(host), host).toBe(Bot);
    }
  });
});
