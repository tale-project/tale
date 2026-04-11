import { describe, expect, it } from 'vitest';

import type { ModelAccessConfig } from '../../lib/shared/schemas/governance';
import { _testInternals } from './model_access_enforcement';

const { resolveAllowedAndBlockedModels, isModelPermitted } = _testInternals;

function makeConfig(
  overrides: Partial<ModelAccessConfig> = {},
): ModelAccessConfig {
  return {
    enabled: true,
    mode: 'allowlist',
    rules: [],
    ...overrides,
  };
}

describe('model_access_enforcement', () => {
  describe('resolveAllowedAndBlockedModels', () => {
    it('returns null when there are no rules', () => {
      const config = makeConfig({ rules: [] });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        ['team-1'],
        'member',
      );
      expect(result).toBeNull();
    });

    it('returns user-scope rule when it matches', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'default',
            allowedModels: ['gpt-4o'],
          },
          {
            scope: 'user',
            scopeId: 'user-1',
            allowedModels: ['claude-sonnet-4'],
            blockedModels: ['gpt-3.5-turbo'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        [],
        'member',
      );
      expect(result).toEqual({
        allowedModels: ['claude-sonnet-4'],
        blockedModels: ['gpt-3.5-turbo'],
      });
    });

    it('user-scope takes priority over team-scope', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'team',
            scopeId: 'team-1',
            allowedModels: ['gpt-4o'],
          },
          {
            scope: 'user',
            scopeId: 'user-1',
            allowedModels: ['claude-sonnet-4'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        ['team-1'],
        'member',
      );
      expect(result?.allowedModels).toEqual(['claude-sonnet-4']);
    });

    it('team-scope takes priority over role-scope', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'role',
            scopeId: 'member',
            allowedModels: ['gpt-3.5-turbo'],
          },
          {
            scope: 'team',
            scopeId: 'team-1',
            allowedModels: ['gpt-4o'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        ['team-1'],
        'member',
      );
      expect(result?.allowedModels).toEqual(['gpt-4o']);
    });

    it('role-scope takes priority over default-scope', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'default',
            allowedModels: ['gpt-3.5-turbo'],
          },
          {
            scope: 'role',
            scopeId: 'developer',
            allowedModels: ['gpt-4o', 'claude-sonnet-4'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        [],
        'developer',
      );
      expect(result?.allowedModels).toEqual(['gpt-4o', 'claude-sonnet-4']);
    });

    it('falls back to default-scope when no other scope matches', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'user',
            scopeId: 'other-user',
            allowedModels: ['claude-sonnet-4'],
          },
          {
            scope: 'default',
            allowedModels: ['gpt-3.5-turbo'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        [],
        'member',
      );
      expect(result?.allowedModels).toEqual(['gpt-3.5-turbo']);
    });

    it('unions allowed models across multiple matching team rules', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'team',
            scopeId: 'team-1',
            allowedModels: ['gpt-4o'],
          },
          {
            scope: 'team',
            scopeId: 'team-2',
            allowedModels: ['claude-sonnet-4', 'gpt-4o'],
            blockedModels: ['gpt-3.5-turbo'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        ['team-1', 'team-2'],
        'member',
      );
      expect(result?.allowedModels).toContain('gpt-4o');
      expect(result?.allowedModels).toContain('claude-sonnet-4');
      expect(result?.blockedModels).toEqual(['gpt-3.5-turbo']);
    });

    it('ignores team rules the user does not belong to', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'team',
            scopeId: 'team-other',
            allowedModels: ['gpt-4o'],
          },
          {
            scope: 'default',
            allowedModels: ['gpt-3.5-turbo'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        ['team-1'],
        'member',
      );
      expect(result?.allowedModels).toEqual(['gpt-3.5-turbo']);
    });

    it('returns null when no rule matches and no default exists', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'user',
            scopeId: 'other-user',
            allowedModels: ['gpt-4o'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        [],
        'member',
      );
      expect(result).toBeNull();
    });

    it('handles missing userRole gracefully', () => {
      const config = makeConfig({
        rules: [
          {
            scope: 'role',
            scopeId: 'developer',
            allowedModels: ['gpt-4o'],
          },
          {
            scope: 'default',
            allowedModels: ['gpt-3.5-turbo'],
          },
        ],
      });
      const result = resolveAllowedAndBlockedModels(
        config,
        'user-1',
        [],
        undefined,
      );
      expect(result?.allowedModels).toEqual(['gpt-3.5-turbo']);
    });
  });

  describe('isModelPermitted', () => {
    it('allowlist mode: permits model in allowedModels', () => {
      expect(isModelPermitted('allowlist', ['gpt-4o'], [], 'gpt-4o')).toBe(
        true,
      );
    });

    it('allowlist mode: rejects model not in allowedModels', () => {
      expect(
        isModelPermitted('allowlist', ['gpt-4o'], [], 'claude-sonnet-4'),
      ).toBe(false);
    });

    it('allowlist mode: blockedModels overrides allowedModels', () => {
      expect(
        isModelPermitted('allowlist', ['gpt-4o'], ['gpt-4o'], 'gpt-4o'),
      ).toBe(false);
    });

    it('blocklist mode: permits model not in blockedModels', () => {
      expect(isModelPermitted('blocklist', [], [], 'gpt-4o')).toBe(true);
    });

    it('blocklist mode: rejects model in blockedModels', () => {
      expect(isModelPermitted('blocklist', [], ['gpt-4o'], 'gpt-4o')).toBe(
        false,
      );
    });

    it('blocklist mode: ignores allowedModels', () => {
      expect(
        isModelPermitted('blocklist', ['gpt-4o'], [], 'claude-sonnet-4'),
      ).toBe(true);
    });
  });
});
