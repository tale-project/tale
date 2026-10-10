import { describe, expect, it } from 'vitest';

import { modelAccessConfigSchema, POLICY_SCHEMAS } from './governance';

describe('model access targets', () => {
  it.each(['user', 'team', 'role'])(
    'rejects missing or blank %s targets at the write boundary',
    (scope) => {
      for (const mode of ['allowlist', 'blocklist']) {
        for (const scopeId of [undefined, '', '   ', '\t\n']) {
          const result = POLICY_SCHEMAS.model_access.safeParse({
            enabled: true,
            mode,
            rules: [
              {
                scope,
                scopeId,
                allowedModels: [],
                blockedModels: ['fixture/model'],
              },
            ],
          });
          expect(result.success).toBe(false);
          if (!result.success)
            expect(result.error.issues[0]?.path).toEqual([
              'rules',
              0,
              'scopeId',
            ]);
        }
      }
    },
  );

  it.each(['user', 'team', 'role', 'default'])(
    'accepts valid %s rules in both modes',
    (scope) => {
      for (const mode of ['allowlist', 'blocklist']) {
        expect(
          modelAccessConfigSchema.safeParse({
            enabled: true,
            mode,
            rules: [
              {
                scope,
                scopeId: scope === 'default' ? undefined : 'target',
                allowedModels: [],
                blockedModels: ['fixture/model'],
              },
            ],
          }).success,
        ).toBe(true);
      }
    },
  );
});
