/**
 * The names a harness calls its models by, on the wire to the model relay:
 * a standard connector's shared record, an organization's own per-model
 * record for any other connector, and the Anthropic-lane sibling.
 */

import { describe, expect, it } from 'vitest';

import { resolveGatewayRouting } from './gateway_routing';

const ORG = 'org_1';

describe('resolveGatewayRouting', () => {
  it('routes a standard connector to the shared native record, whatever the org', () => {
    expect(resolveGatewayRouting(ORG, 'anthropic', 'claude-fable-5')).toEqual({
      gatewayProvider: 'anthropic',
      gatewayModel: 'anthropic/claude-fable-5',
    });
    expect(
      resolveGatewayRouting('org_2', 'anthropic', 'claude-fable-5'),
    ).toEqual(resolveGatewayRouting(ORG, 'anthropic', 'claude-fable-5'));
  });

  it("routes a custom connector to the org's own per-model record with slashes sanitized out of the record name", () => {
    expect(
      resolveGatewayRouting(ORG, 'vercel-ai-gateway', 'alibaba/qwen-3-14b'),
    ).toEqual({
      gatewayProvider: 'org_1__vercel-ai-gateway__alibaba_qwen-3-14b',
      gatewayModel:
        'org_1__vercel-ai-gateway__alibaba_qwen-3-14b/alibaba/qwen-3-14b',
    });
  });

  it('routes a custom connector to a distinct `__anthropic` record for the Claude Code lane', () => {
    const openai = resolveGatewayRouting(ORG, 'deepseek', 'deepseek-v4-flash');
    const anthropic = resolveGatewayRouting(
      ORG,
      'deepseek',
      'deepseek-v4-flash',
      { anthropicHarnessLane: true },
    );
    expect(openai.gatewayProvider).toBe('org_1__deepseek__deepseek-v4-flash');
    expect(anthropic.gatewayProvider).toBe(
      'org_1__deepseek__deepseek-v4-flash__anthropic',
    );
    // Distinct records → the two upstreams (openai base vs native anthropic)
    // never stand for each other for the same (org, model).
    expect(anthropic.gatewayProvider).not.toBe(openai.gatewayProvider);
    expect(anthropic.gatewayModel).toBe(
      'org_1__deepseek__deepseek-v4-flash__anthropic/deepseek-v4-flash',
    );
  });

  it('routes a standard connector on the Claude Code lane to an org-scoped `__anthropic` record', () => {
    // OpenRouter is a standard connector whose shared record speaks the
    // OpenAI wire only; its Anthropic Messages door has a record of its own,
    // kept apart from the shared record every other harness keeps using. The
    // lane flag is only ever set by serving, for a connector that declares a
    // harness endpoint.
    const shared = resolveGatewayRouting(
      ORG,
      'openrouter',
      'anthropic/claude-sonnet-5',
    );
    const lane = resolveGatewayRouting(
      ORG,
      'openrouter',
      'anthropic/claude-sonnet-5',
      { anthropicHarnessLane: true },
    );
    expect(shared).toEqual({
      gatewayProvider: 'openrouter',
      gatewayModel: 'openrouter/anthropic/claude-sonnet-5',
    });
    expect(lane).toEqual({
      gatewayProvider:
        'org_1__openrouter__anthropic_claude-sonnet-5__anthropic',
      gatewayModel:
        'org_1__openrouter__anthropic_claude-sonnet-5__anthropic/anthropic/claude-sonnet-5',
    });
    // Org-scoped: two orgs never share the door's record.
    expect(
      resolveGatewayRouting(
        'org_2',
        'openrouter',
        'anthropic/claude-sonnet-5',
        {
          anthropicHarnessLane: true,
        },
      ).gatewayProvider,
    ).not.toBe(lane.gatewayProvider);
  });

  it('gives two orgs sharing a custom connector name two distinct records', () => {
    // Custom connectors are org-defined files: two orgs may name one
    // `internal` with different base URLs or wire formats, and each org's
    // name must lead to its own.
    const a = resolveGatewayRouting(ORG, 'internal', 'llama-4');
    const b = resolveGatewayRouting('org_2', 'internal', 'llama-4');
    expect(a.gatewayProvider).not.toBe(b.gatewayProvider);
    expect(a.gatewayModel).not.toBe(b.gatewayModel);
  });
});
