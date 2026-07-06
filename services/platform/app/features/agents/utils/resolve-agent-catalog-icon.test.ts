import { Bot, Code, Telescope, Terminal } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ClaudeIcon } from '@/app/components/icons/claude-icon';

import {
  resolveAgentCatalogIcon,
  rosterStatusFromEntry,
} from './resolve-agent-catalog-icon';

describe('resolveAgentCatalogIcon', () => {
  it('uses the Claude brand mark for the claude-code product slug', () => {
    const { kind, Icon } = resolveAgentCatalogIcon({
      slug: 'claude-code',
      agentKind: 'claude-code',
      composerModeIcon: 'terminal',
      labels: [],
    });
    expect(kind).toBe('brand');
    expect(Icon).toBe(ClaudeIcon);
  });

  it('does not use the Claude brand for workforce agents on the claude-code runtime', () => {
    const { kind, Icon } = resolveAgentCatalogIcon({
      slug: 'software-developer',
      agentKind: 'claude-code',
      labels: ['Engineering'],
    });
    expect(kind).toBe('lucide');
    expect(Icon).toBe(Code);
  });

  it('uses composerMode icons when present', () => {
    const { kind, Icon } = resolveAgentCatalogIcon({
      slug: 'researcher',
      composerModeIcon: 'telescope',
      labels: [],
    });
    expect(kind).toBe('lucide');
    expect(Icon).toBe(Telescope);
  });

  it('maps workforce labels to role icons', () => {
    const { Icon } = resolveAgentCatalogIcon({
      slug: 'software-developer',
      labels: ['Engineering'],
    });
    expect(Icon).toBe(Code);
  });

  it('falls back to Bot when no stronger signal exists', () => {
    const { Icon } = resolveAgentCatalogIcon({ slug: 'custom', labels: [] });
    expect(Icon).toBe(Bot);
  });

  it('uses Terminal for opencode external agents', () => {
    const { Icon } = resolveAgentCatalogIcon({
      slug: 'opencode-agent',
      agentKind: 'opencode',
      labels: [],
    });
    expect(Icon).toBe(Terminal);
  });
});

describe('rosterStatusFromEntry', () => {
  it('maps install rows to roster status', () => {
    expect(rosterStatusFromEntry({ installed: false, enabled: false })).toBe(
      'available',
    );
    expect(rosterStatusFromEntry({ installed: true, enabled: true })).toBe(
      'enabled',
    );
    expect(rosterStatusFromEntry({ installed: true, enabled: false })).toBe(
      'disabled',
    );
  });
});
