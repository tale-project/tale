import { describe, it, expect, vi } from 'vitest';

import {
  resolveTemplateVariables,
  SUPPORTED_TEMPLATE_VARIABLES,
} from './resolve_template_variables';

function createMockCtx(orgName?: string, userName?: string) {
  return {
    runQuery: vi.fn((_ref: unknown, args: Record<string, unknown>) => {
      const model = args.model;
      if (model === 'organization') {
        return orgName ? { _id: 'org_1', name: orgName } : null;
      }
      if (model === 'user') {
        return userName ? { _id: 'user_1', name: userName } : null;
      }
      return null;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('resolveTemplateVariables', () => {
  it('returns instructions unchanged when no variables present', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(
      ctx,
      'You are a helpful assistant.',
      { organizationId: 'org_1' },
    );

    expect(result).toBe('You are a helpful assistant.');
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('resolves {{organization.name}}', async () => {
    const ctx = createMockCtx('Acme Corp');
    const result = await resolveTemplateVariables(
      ctx,
      'You work for {{organization.name}}.',
      { organizationId: 'org_1' },
    );

    expect(result).toBe('You work for Acme Corp.');
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('resolves {{organization.id}} without query', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(
      ctx,
      'Org: {{organization.id}}',
      { organizationId: 'org_123' },
    );

    expect(result).toBe('Org: org_123');
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('resolves {{user.name}}', async () => {
    const ctx = createMockCtx(undefined, 'Alice');
    const result = await resolveTemplateVariables(ctx, 'Hello {{user.name}}!', {
      organizationId: 'org_1',
      userId: 'user_1',
    });

    expect(result).toBe('Hello Alice!');
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it('resolves {{current_time}} to ISO string', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(
      ctx,
      'Time: {{current_time}}',
      { organizationId: 'org_1' },
    );

    expect(result).toMatch(/^Time: \d{4}-\d{2}-\d{2}T/);
  });

  it('resolves {{current_date}} to date only', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(
      ctx,
      'Date: {{current_date}}',
      { organizationId: 'org_1' },
    );

    expect(result).toMatch(/^Date: \d{4}-\d{2}-\d{2}$/);
  });

  it('resolves multiple variables in one string', async () => {
    const ctx = createMockCtx('Acme', 'Bob');
    const result = await resolveTemplateVariables(
      ctx,
      'Welcome {{user.name}} from {{organization.name}}. ID: {{organization.id}}',
      { organizationId: 'org_42', userId: 'user_1' },
    );

    expect(result).toBe('Welcome Bob from Acme. ID: org_42');
  });

  it('replaces with empty string when org not found', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(
      ctx,
      'Org: {{organization.name}}',
      { organizationId: 'org_missing' },
    );

    expect(result).toBe('Org: ');
  });

  it('replaces with empty string when user has no userId', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(ctx, 'User: {{user.name}}', {
      organizationId: 'org_1',
    });

    expect(result).toBe('User: ');
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('preserves unknown variables unchanged', async () => {
    const ctx = createMockCtx();
    const result = await resolveTemplateVariables(
      ctx,
      'Value: {{unknown.var}}',
      { organizationId: 'org_1' },
    );

    expect(result).toBe('Value: {{unknown.var}}');
  });

  it('only queries org when org variables are present', async () => {
    const ctx = createMockCtx();
    await resolveTemplateVariables(ctx, 'Time: {{current_time}}', {
      organizationId: 'org_1',
    });

    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('queries both org and user when both are needed', async () => {
    const ctx = createMockCtx('Acme', 'Alice');
    await resolveTemplateVariables(
      ctx,
      '{{organization.name}} - {{user.name}}',
      { organizationId: 'org_1', userId: 'user_1' },
    );

    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });
});

describe('SUPPORTED_TEMPLATE_VARIABLES', () => {
  it('has expected variables', () => {
    const vars = SUPPORTED_TEMPLATE_VARIABLES.map((v) => v.variable);
    expect(vars).toContain('{{current_time}}');
    expect(vars).toContain('{{current_date}}');
    expect(vars).toContain('{{organization.id}}');
    expect(vars).toContain('{{organization.name}}');
    expect(vars).toContain('{{user.name}}');
  });
});
