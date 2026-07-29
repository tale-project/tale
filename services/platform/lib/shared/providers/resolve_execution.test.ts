import { describe, expect, it } from 'vitest';

import {
  harnessConnectorSchema,
  modelCatalogEntrySchema,
  type HarnessConnector,
} from '../schemas/providers';
import {
  buildHarnessTable,
  resolveExecution,
  type CredentialAuth,
  type ExecutionSelection,
} from './resolve_execution';

// The three harness archetypes the case split distinguishes: both-modes
// (claude-code), bring-your-own only (cursor), managed only (opencode).
// Parsed through the schema so the fixtures can never drift from the shape
// the loader would deliver.

function harness(
  slug: string,
  policy: { managed: boolean; byo: boolean },
): HarnessConnector {
  return harnessConnectorSchema.parse({
    slug,
    displayName: slug,
    credentialPolicy: policy,
    credentialEnvKeys: ['TALE_GATEWAY_TOKEN'],
    modelIdDialect: 'vendor-native',
    promptTransport: 'stdin-ndjson',
    capabilities: { planMode: false, steering: false, mcp: false },
    // Minimal exec facts satisfying the schema's coherence refinements —
    // the case split under test reads only the policy/capability fields.
    parser: 'hermes-jsonl',
    exec: {
      bin: 'test-harness',
      argv: [{ args: ['--workdir', '${workdir}'] }],
      stdin: { mode: 'json-envelope', envelope: [{ prompt: {} }] },
      ...(policy.managed && {
        env: { managed: { TALE_GATEWAY_TOKEN: '${gateway.token}' } },
      }),
    },
  });
}

const HARNESSES = buildHarnessTable([
  harness('claude-code', { managed: true, byo: true }),
  harness('cursor', { managed: false, byo: true }),
  harness('opencode', { managed: true, byo: false }),
]);

const MODEL = modelCatalogEntrySchema.parse({
  id: 'claude-fable-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 200000,
});

const API_KEY: CredentialAuth = { authMethod: 'api-key' };
const ENV: CredentialAuth = { authMethod: 'env' };
const BROKER: CredentialAuth = {
  authMethod: 'subscription-broker',
  constraints: { execution: 'sandbox', harness: 'claude-code' },
};
const SUBSCRIPTION_KEY: CredentialAuth = {
  authMethod: 'subscription-key',
  constraints: { execution: 'sandbox', harness: 'claude-code' },
};

function resolve(selection: Omit<ExecutionSelection, 'model'>) {
  return resolveExecution({ model: MODEL, ...selection }, HARNESSES);
}

describe('resolveExecution — direct mode', () => {
  it('allows direct for api-key and env credentials', () => {
    expect(resolve({ credential: API_KEY, mode: 'direct' })).toEqual({
      mode: 'direct',
    });
    expect(resolve({ credential: ENV, mode: 'direct' })).toEqual({
      mode: 'direct',
    });
  });

  it('refuses direct for a subscription-broker credential, naming the forced harness', () => {
    const result = resolve({ credential: BROKER, mode: 'direct' });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('claude-code');
      expect(result.reason).toContain('sandbox');
      expect(result.reason).toContain(MODEL.id);
    }
  });
});

describe('resolveExecution — subscription-key (static plan/portal keys)', () => {
  it('refuses direct exactly like the broker flavor', () => {
    const result = resolve({ credential: SUBSCRIPTION_KEY, mode: 'direct' });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('claude-code');
    }
  });

  it('forces the constrained harness in sandbox mode', () => {
    const result = resolve({ credential: SUBSCRIPTION_KEY, mode: 'sandbox' });
    expect(result).toMatchObject({
      mode: 'sandbox',
      harness: { slug: 'claude-code' },
    });
  });

  it('refuses any other requested harness, naming the forced one', () => {
    const result = resolve({
      credential: SUBSCRIPTION_KEY,
      mode: 'sandbox',
      harness: 'codex',
    });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('"claude-code"');
    }
  });
});

describe('resolveExecution — sandbox mode, api-key/env (managed posture)', () => {
  it('runs the requested harness when it accepts managed credentials', () => {
    for (const credential of [API_KEY, ENV]) {
      for (const slug of ['claude-code', 'opencode']) {
        const result = resolve({ credential, mode: 'sandbox', harness: slug });
        expect(result.mode).toBe('sandbox');
        if (result.mode === 'sandbox') {
          expect(result.harness.slug).toBe(slug);
        }
      }
    }
  });

  it('refuses a byo-only harness (cursor) for managed credentials', () => {
    for (const credential of [API_KEY, ENV]) {
      const result = resolve({
        credential,
        mode: 'sandbox',
        harness: 'cursor',
      });
      expect(result.mode).toBe('refused');
      if (result.mode === 'refused') {
        expect(result.reason).toContain('cursor');
        expect(result.reason).toContain('bring-your-own');
      }
    }
  });

  it('refuses when no harness was selected, listing the available ones', () => {
    const result = resolve({ credential: API_KEY, mode: 'sandbox' });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('claude-code, cursor, opencode');
    }
  });

  it('refuses an unknown harness, listing the available ones', () => {
    const result = resolve({
      credential: ENV,
      mode: 'sandbox',
      harness: 'aider',
    });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('"aider"');
      expect(result.reason).toContain('claude-code, cursor, opencode');
    }
  });
});

describe('resolveExecution — sandbox mode, subscription-broker (byo posture)', () => {
  it('uses the forced harness when none is requested', () => {
    const result = resolve({ credential: BROKER, mode: 'sandbox' });
    expect(result.mode).toBe('sandbox');
    if (result.mode === 'sandbox') {
      expect(result.harness.slug).toBe('claude-code');
    }
  });

  it('accepts an explicit request for the forced harness', () => {
    const result = resolve({
      credential: BROKER,
      mode: 'sandbox',
      harness: 'claude-code',
    });
    expect(result.mode).toBe('sandbox');
    if (result.mode === 'sandbox') {
      expect(result.harness.slug).toBe('claude-code');
    }
  });

  it('refuses any other requested harness, naming the forced one', () => {
    for (const slug of ['cursor', 'opencode']) {
      const result = resolve({
        credential: BROKER,
        mode: 'sandbox',
        harness: slug,
      });
      expect(result.mode).toBe('refused');
      if (result.mode === 'refused') {
        expect(result.reason).toContain('claude-code');
        expect(result.reason).toContain(`"${slug}"`);
      }
    }
  });

  it('refuses a managed-only forced harness (opencode cannot take the token)', () => {
    const brokerToOpencode: CredentialAuth = {
      authMethod: 'subscription-broker',
      constraints: { execution: 'sandbox', harness: 'opencode' },
    };
    const result = resolve({ credential: brokerToOpencode, mode: 'sandbox' });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('opencode');
      expect(result.reason).toContain('managed');
    }
  });

  it('refuses when the forced harness is not in the table', () => {
    const brokerToMissing: CredentialAuth = {
      authMethod: 'subscription-broker',
      constraints: { execution: 'sandbox', harness: 'retired-cli' },
    };
    const result = resolve({ credential: brokerToMissing, mode: 'sandbox' });
    expect(result.mode).toBe('refused');
    if (result.mode === 'refused') {
      expect(result.reason).toContain('"retired-cli"');
    }
  });
});

describe('buildHarnessTable', () => {
  it('keys harnesses by slug', () => {
    const table = buildHarnessTable([
      harness('pi', { managed: true, byo: true }),
    ]);
    expect(table.get('pi')?.slug).toBe('pi');
    expect(table.size).toBe(1);
  });
});
