/**
 * Unit tests for the JSON-Schema-subset validator + the config-file →
 * checkpoint-schema-key mapping the versions suite validates org trees with.
 */

import { describe, expect, it } from 'vitest';

import {
  configSchemaCandidates,
  validateJsonValue,
} from './config_validate.testkit';

describe('validateJsonValue', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      count: { type: 'number' },
      mode: { anyOf: [{ const: 'a' }, { const: 'b' }] },
      tags: { type: 'array', items: { type: 'string' } },
      nested: {
        type: 'object',
        properties: { flag: { type: 'boolean' } },
        required: ['flag'],
        additionalProperties: false,
      },
    },
    required: ['name'],
    additionalProperties: false,
  };

  it('accepts a conforming document', () => {
    expect(
      validateJsonValue(
        {
          name: 'x',
          count: 2,
          mode: 'a',
          tags: ['t'],
          nested: { flag: true },
        },
        schema,
        'f.json',
      ),
    ).toBeNull();
  });

  it('reports missing required and mistyped fields precisely', () => {
    expect(validateJsonValue({}, schema, 'f.json')).toContain(
      'f.json.name: required field missing',
    );
    // Undeclared keys are TOLERATED: Zod emits additionalProperties:false
    // for plain z.object too, whose parse strips unknown keys — an extra
    // field never broke the release the schema came from.
    expect(
      validateJsonValue({ name: 'x', extra: 1 }, schema, 'f.json'),
    ).toBeNull();
    expect(
      validateJsonValue({ name: 'x', count: 'nope' }, schema, 'f.json'),
    ).toContain('f.json.count: expected number, got string');
    expect(
      validateJsonValue({ name: 'x', mode: 'c' }, schema, 'f.json'),
    ).toContain('no union member matches');
    expect(
      validateJsonValue({ name: 'x', tags: ['ok', 5] }, schema, 'f.json'),
    ).toContain('f.json.tags[1]: expected string, got integer');
    expect(
      validateJsonValue({ name: 'x', nested: {} }, schema, 'f.json'),
    ).toContain('f.json.nested.flag: required field missing');
  });

  it('treats integers as numbers, resolves $defs refs, and ignores unknown refs', () => {
    expect(
      validateJsonValue({ name: 'x', count: 3 }, schema, 'f.json'),
    ).toBeNull();

    const withDefs = {
      $defs: { leaf: { type: 'string' } },
      type: 'object',
      properties: { v: { $ref: '#/$defs/leaf' } },
    };
    expect(validateJsonValue({ v: 'ok' }, withDefs, 'f')).toBeNull();
    expect(validateJsonValue({ v: 7 }, withDefs, 'f')).toContain(
      'f.v: expected string, got integer',
    );
    // Unresolvable ref = any (never a false positive).
    expect(
      validateJsonValue({ v: 7 }, { $ref: 'https://ext/x' }, 'f'),
    ).toBeNull();
  });

  it('validates record-style additionalProperties schemas', () => {
    const record = {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { label: { type: 'string' } },
        additionalProperties: false,
      },
    };
    expect(validateJsonValue({ en: { label: 'ok' } }, record, 'f')).toBeNull();
    expect(validateJsonValue({ en: { label: 5 } }, record, 'f')).toContain(
      'f.en.label: expected string, got integer',
    );
  });
});

describe('configSchemaCandidates', () => {
  it('maps the corpus file layout to checkpoint schema keys', () => {
    expect(configSchemaCandidates('branding/branding.json')).toEqual([
      'branding.brandingJsonSchema',
    ]);
    expect(configSchemaCandidates('agents/chat/assistant.json')).toEqual([
      'agents.agentJsonSchema',
    ]);
    expect(configSchemaCandidates('apps/issue-desk/app.json')).toEqual([
      'apps.appManifestSchema',
    ]);
    expect(
      configSchemaCandidates('apps/issue-desk/workflows/x/y.json'),
    ).toEqual(['workflows.workflowJsonSchema']);
    expect(configSchemaCandidates('providers/openrouter.json')).toEqual([
      'providers.providerJsonSchema',
    ]);
    expect(configSchemaCandidates('providers/openrouter.secrets.json')).toEqual(
      ['providers.providerSecretsSchema'],
    );
    expect(
      configSchemaCandidates('governance/sso/connection.secrets.json'),
    ).toEqual(['enterprise_sso.ssoConnectionSecretsSchema']);
  });

  it('derives governance candidates from the kebab basename, policy variant included', () => {
    expect(configSchemaCandidates('governance/password-policy.json')).toEqual([
      'governance.passwordPolicyConfigSchema',
      'governance.passwordPolicyPolicyConfigSchema',
      'governance.passwordPolicySchema',
    ]);
    expect(configSchemaCandidates('governance/run-code.json')).toContain(
      'governance.runCodePolicyConfigSchema',
    );
  });

  it('returns no candidates for unmapped files', () => {
    expect(configSchemaCandidates('connectors/foo.json')).toEqual([]);
    expect(configSchemaCandidates('branding/logo.png')).toEqual([]);
  });
});
