// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  sanctionSubscriptionHarnessTurn,
  subscriptionApiBaseUrl,
} from '../lib/providers/agent_serving';
import {
  loadProviderDefinitions,
  loadStaticCatalogs,
} from '../lib/providers/load_system_config';
import { buildExternalTurnExec } from './external_turn_shared';

const TURN = {
  execId: 'broker-exec',
  prompt: 'Check the synthetic project.',
  instructions: 'Keep the working tree clean.',
  bridgeUrl: 'https://platform.example.com/capabilities',
};

describe('subscription broker delivery through the real external turn builder', () => {
  it('preserves the Anthropic OAuth channel and keeps the bridge token separate', () => {
    const exec = buildExternalTurnExec({
      ...TURN,
      harness: 'claude-code',
      gatewayModel: 'claude-sonnet-4-6',
      serving: {
        kind: 'subscription',
        secret: 'synthetic-oauth-token',
        baseUrl: 'https://api.anthropic.com',
        targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        bridgeToken: 'synthetic-session-bridge',
      },
      extraEnv: {
        ANTHROPIC_AUTH_TOKEN: 'stale-bearer',
        ANTHROPIC_API_KEY: 'stale-api-key',
      },
    });
    expect(exec.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('synthetic-oauth-token');
    expect(exec.env.ANTHROPIC_AUTH_TOKEN).toBe('');
    expect(exec.env.ANTHROPIC_API_KEY).toBe('');
    expect(exec.argv.join(' ')).toContain('synthetic-session-bridge');
    expect(exec.argv.join(' ')).not.toContain('synthetic-oauth-token');
  });

  it('sanctions shipped OpenAI subscriptions and launches the dedicated ChatGPT endpoint', () => {
    const provider = loadProviderDefinitions().find(
      (item) => item.name === 'openai',
    );
    expect(provider).toBeDefined();
    if (provider === undefined) return;
    const model = loadStaticCatalogs()
      .get('openai')
      ?.find((entry) => entry.id === 'gpt-6.1-sol');
    expect(model).toBeDefined();
    if (model === undefined) return;
    expect(
      sanctionSubscriptionHarnessTurn({
        provider,
        authMethod: 'subscription-broker',
        model: model.id,
        harness: 'codex',
      }),
    ).toEqual({ ok: true });
    const baseUrl = subscriptionApiBaseUrl(provider, 'subscription-broker');
    expect(baseUrl).toBe('https://chatgpt.com/backend-api/codex');
    const exec = buildExternalTurnExec({
      ...TURN,
      harness: 'codex',
      gatewayModel: model.id,
      serving: {
        kind: 'subscription',
        secret: 'synthetic-openai-oauth',
        baseUrl: baseUrl!,
        targetEnvVar: 'TALE_SUBSCRIPTION_TOKEN',
        accountId: 'synthetic-chatgpt-account',
        bridgeToken: 'synthetic-session-bridge',
      },
    });
    expect(exec.env.TALE_SUBSCRIPTION_TOKEN).toBe('synthetic-openai-oauth');
    expect(exec.env.TALE_SUBSCRIPTION_ACCOUNT_ID).toBe(
      'synthetic-chatgpt-account',
    );
    expect(exec.env.TALE_CONNECTORS_TOKEN).toBe('synthetic-session-bridge');
    expect(exec.argv).toContain('model_provider="tale-subscription"');
    expect(exec.argv).toContain(
      'model_providers.tale-subscription.wire_api="responses"',
    );
    expect(exec.argv).toContain('gpt-6.1-sol');
    expect(exec.env.OPENAI_API_KEY).toBe('');
    expect(exec.argv.join(' ')).not.toContain('synthetic-openai-oauth');
  });
});
