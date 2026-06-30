// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentDisplayName } from './hooks';

// `useAgentDisplayName` resolves a slug -> locale-aware display name from the
// same roster the agents List uses. We drive the two real inputs — the
// `useListAgents` roster and the active i18n locale — through mutable module
// state so each case can stage its own roster/locale. The resolver itself
// (`toConfigurableAgent` + `resolveAgentLocale`) runs for real.
let mockAgents: unknown[] | undefined = [];
let mockLocale = 'en';

vi.mock('../hooks/queries', () => ({
  useListAgents: () => ({ agents: mockAgents, isLoading: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLocale } }),
}));

beforeEach(() => {
  mockAgents = [];
  mockLocale = 'en';
});

describe('useAgentDisplayName', () => {
  it('resolves a known slug to its configured display name', () => {
    mockAgents = [{ name: 'assistant', displayName: 'E2E Assistant' }];
    const { result } = renderHook(() => useAgentDisplayName('org-1'));
    expect(result.current('assistant')).toBe('E2E Assistant');
  });

  it('falls back to the raw slug verbatim for an unknown/uninstalled agent', () => {
    mockAgents = [{ name: 'assistant', displayName: 'E2E Assistant' }];
    const { result } = renderHook(() => useAgentDisplayName('org-1'));
    expect(result.current('not-installed')).toBe('not-installed');
  });

  it('resolves app-owned composite `<appSlug>/<name>` slugs by their composite key', () => {
    mockAgents = [
      {
        name: 'workforce/software-developer',
        displayName: 'Software Developer',
        appSlug: 'workforce',
        folder: 'workforce',
      },
    ];
    const { result } = renderHook(() => useAgentDisplayName('org-1'));
    expect(result.current('workforce/software-developer')).toBe(
      'Software Developer',
    );
  });

  it('is locale-aware — switching the active locale changes the resolved name', () => {
    mockAgents = [
      {
        name: 'assistant',
        displayName: 'Assistant',
        i18n: { de: { displayName: 'Assistent' } },
      },
    ];

    const { result, rerender } = renderHook(() => useAgentDisplayName('org-1'));
    expect(result.current('assistant')).toBe('Assistant');

    mockLocale = 'de';
    rerender();
    expect(result.current('assistant')).toBe('Assistent');
  });

  it('skips agents whose resolved display name is empty, falling back to the slug', () => {
    mockAgents = [{ name: 'assistant', displayName: '' }];
    const { result } = renderHook(() => useAgentDisplayName('org-1'));
    expect(result.current('assistant')).toBe('assistant');
  });

  it('returns the slug while the roster is still loading (undefined agents)', () => {
    mockAgents = undefined;
    const { result } = renderHook(() => useAgentDisplayName('org-1'));
    expect(result.current('assistant')).toBe('assistant');
  });
});
