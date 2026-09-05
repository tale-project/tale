import { describe, expect, it } from 'vitest';

import type { DefaultModelRule } from '../../../lib/shared/schemas/governance';
import { findApplicableModelRule } from './resolve_default_model';

/**
 * The `default_models` rule selection the governance seam
 * (`resolveModelGovernanceForUser`) composes with the model-access verdict:
 * team > role > default, first match in rules-array order within a scope.
 */
describe('findApplicableModelRule', () => {
  const DEFAULT: DefaultModelRule = {
    scope: 'default',
    providerName: 'anthropic',
    modelId: 'claude-sonnet',
  };

  it('returns null when no rule applies', () => {
    expect(findApplicableModelRule([], ['team-1'], 'member')).toBeNull();
  });

  it('returns the team-scoped rule when the user belongs to that team', () => {
    const rule = findApplicableModelRule(
      [
        {
          scope: 'team',
          scopeId: 'team-engineering',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
        DEFAULT,
      ],
      ['team-engineering'],
      'member',
    );
    expect(rule).toEqual({
      scope: 'team',
      scopeId: 'team-engineering',
      providerName: 'openai',
      modelId: 'gpt-4o',
    });
  });

  it('team rule takes priority over role rule', () => {
    const rule = findApplicableModelRule(
      [
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'anthropic',
          modelId: 'claude-opus',
        },
        {
          scope: 'team',
          scopeId: 'team-1',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
      ['team-1'],
      'admin',
    );
    expect(rule?.modelId).toBe('gpt-4o');
  });

  it('role rule takes priority over default rule', () => {
    const rule = findApplicableModelRule(
      [
        DEFAULT,
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'anthropic',
          modelId: 'claude-opus',
        },
      ],
      [],
      'admin',
    );
    expect(rule?.modelId).toBe('claude-opus');
  });

  it('returns the default rule when no team or role matches', () => {
    const rule = findApplicableModelRule(
      [
        {
          scope: 'team',
          scopeId: 'team-other',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'anthropic',
          modelId: 'claude-opus',
        },
        DEFAULT,
      ],
      ['team-1'],
      'member',
    );
    expect(rule).toEqual(DEFAULT);
  });

  it('multi-team membership: first matching rule wins by rules array order', () => {
    const rule = findApplicableModelRule(
      [
        {
          scope: 'team',
          scopeId: 'team-b',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
        {
          scope: 'team',
          scopeId: 'team-a',
          providerName: 'anthropic',
          modelId: 'claude-opus',
        },
      ],
      ['team-a', 'team-b'],
      'member',
    );
    expect(rule?.modelId).toBe('gpt-4o');
  });

  it('returns null when no userRole is provided and only role rules exist', () => {
    const rule = findApplicableModelRule(
      [
        {
          scope: 'role',
          scopeId: 'member',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
      [],
    );
    expect(rule).toBeNull();
  });
});
