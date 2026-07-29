import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../shared/schemas/agents';
import { allowsCapability, allowsSkill, resolveAgentForTurn } from './resolve';

const assistant: AgentDefinition = {
  name: 'assistant',
  displayName: 'Assistant',
  description: 'General help',
  visibility: 'org',
  knowledge: 'documents',
  instructions: 'Be concise.',
  i18n: {
    de: { displayName: 'Assistent', instructions: 'Sei knapp.' },
    en: { instructions: 'Be brief.' },
    fr: { displayName: 'Assistant·e' },
  },
};

describe('resolving an agent for a turn', () => {
  it('speaks the turn’s language', () => {
    const de = resolveAgentForTurn(assistant, 'de');
    expect(de.displayName).toBe('Assistent');
    expect(de.instructions).toBe('Sei knapp.');
  });

  it('falls back through the base language, then English, then the file', () => {
    // `de-CH` has no entry of its own, so it reads `de`.
    expect(resolveAgentForTurn(assistant, 'de-CH').instructions).toBe(
      'Sei knapp.',
    );
    // French overrides only the label, so the English instructions carry.
    const fr = resolveAgentForTurn(assistant, 'fr');
    expect(fr.displayName).toBe('Assistant·e');
    expect(fr.instructions).toBe('Be brief.');
    // A language nobody translated still gets the English layer.
    expect(resolveAgentForTurn(assistant, 'it').displayName).toBe('Assistant');
    expect(resolveAgentForTurn(assistant, 'it').instructions).toBe('Be brief.');
  });

  it('reads the authored field when no locale claims it', () => {
    const plain: AgentDefinition = {
      name: 'writer',
      displayName: 'Writer',
      visibility: 'org',
      knowledge: 'none',
      instructions: 'Write plainly.',
    };
    expect(resolveAgentForTurn(plain, 'de').instructions).toBe(
      'Write plainly.',
    );
  });

  it('treats a blank override as no override at all', () => {
    const blank: AgentDefinition = {
      ...assistant,
      i18n: { de: { displayName: '   ', instructions: '' } },
    };
    const de = resolveAgentForTurn(blank, 'de');
    expect(de.displayName).toBe('Assistant');
    expect(de.instructions).toBe('Be concise.');
  });

  it('carries the knowledge scope and adds nothing about execution', () => {
    const resolved = resolveAgentForTurn(assistant, 'en');
    expect(resolved.knowledge).toBe('documents');
    // A resolved agent is a persona: no model, no ceiling, no harness.
    expect(Object.keys(resolved).sort()).toEqual([
      'description',
      'displayName',
      'instructions',
      'knowledge',
      'slug',
    ]);
  });

  it('leaves an agent with no instructions contributing none', () => {
    const silent: AgentDefinition = {
      name: 'silent',
      displayName: 'Silent',
      visibility: 'org',
      knowledge: 'all',
    };
    expect(resolveAgentForTurn(silent, 'en').instructions).toBeUndefined();
  });
});

describe('what a resolved agent may reach for', () => {
  const narrowed = resolveAgentForTurn(
    {
      ...assistant,
      tools: ['get_knowledge', 'run_code'],
      skills: ['pdf'],
    },
    'en',
  );
  const open = resolveAgentForTurn(assistant, 'en');
  const closed = resolveAgentForTurn(
    { ...assistant, tools: [], skills: [] },
    'en',
  );

  it('honours a hard allowlist', () => {
    expect(allowsCapability(narrowed, 'run_code')).toBe(true);
    expect(allowsCapability(narrowed, 'generate_image')).toBe(false);
    expect(allowsSkill(narrowed, 'pdf')).toBe(true);
    expect(allowsSkill(narrowed, 'docx')).toBe(false);
  });

  it('treats an absent list as "not narrowed"', () => {
    expect(open.tools).toBeUndefined();
    expect(allowsCapability(open, 'generate_image')).toBe(true);
    expect(allowsSkill(open, 'docx')).toBe(true);
  });

  it('treats an empty list as nothing at all', () => {
    expect(allowsCapability(closed, 'run_code')).toBe(false);
    expect(allowsSkill(closed, 'pdf')).toBe(false);
  });
});
