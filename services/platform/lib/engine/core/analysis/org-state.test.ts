import { beforeAll, describe, expect, it, vi } from 'vitest';

import { memoryStore } from '../../selftest/memory-store';
import { registerNodeType, type OrgFacts, type OrgFactsQuery } from '../slots';
import type { Issue } from '../types';
import { validate } from '../validate';
import { orgFactsQuery, orgStateIssues } from './org-state';

/**
 * The org-state pass: what a document names of the organization against
 * what the host says it has. Every finding is a warning, so a save is never
 * refused for it; a fact the host could not tell warns about nothing.
 */

const FACTS: OrgFacts = {
  skills: new Set(['reply-style']),
  connectors: {
    catalogued: new Set(['github', 'gmail', 'crm', 'task']),
    connected: new Set(['github']),
    needsCredential: new Set(['github', 'gmail', 'crm']),
  },
  secrets: new Set(['SUPPORT_SIGNATURE']),
  harnesses: new Set(['claude-code', 'codex']),
};

function agentDoc(over: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 1,
    name: 'support/reply',
    nodes: [
      {
        id: 'reply',
        type: 'agent',
        model: 'test-model',
        prompt: 'Draft the reply.',
        ...over,
      },
    ],
    output: '{{ nodes.reply.output.text }}',
  };
}

function codes(issues: readonly Issue[]): string[] {
  return issues.map((issue) => issue.code);
}

beforeAll(() => {
  for (const [type, hasEffect] of [
    ['crm.create_lead', true],
    ['github.create_issue', true],
    ['task.create', true],
    ['weather.current', false],
  ] as const) {
    registerNodeType({
      type,
      kind: 'connector',
      outputKind: 'structured',
      description: `test connector: ${type}`,
      allowedFields: ['input'],
      requiredFields: ['input'],
      connector: {
        name: type,
        description: type,
        inputSchema: { type: 'object' },
        outputSignature: '{ id: string }',
        hasEffect,
        mock: () => ({ id: 'x' }),
      },
    });
  }
});

describe('org-state warnings [MCP-R15]', () => {
  it('warns, never refuses, when an agent step names a skill, connector, secret or runtime the organization does not have [MCP-R15]', async () => {
    // Ada's agent saves a step that asks for a skill nobody added, Gmail
    // (not connected), a secret nobody stored and a runtime this Tale
    // cannot run.
    const store = memoryStore({ orgFacts: FACTS });
    const result = await validate(
      agentDoc({
        harness: 'cursor',
        skills: ['reply-style', 'tone-guide'],
        connectors: ['github', 'gmail'],
        secrets: ['SUPPORT_SIGNATURE', 'CRM_TOKEN'],
      }),
      { store },
    );
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([
      'HARNESS_UNKNOWN',
      'SKILL_UNKNOWN',
      'CONNECTOR_NOT_CONNECTED',
      'SECRET_UNKNOWN',
    ]);
    const [harness, skill, connector, secret] = result.warnings;
    expect(harness).toMatchObject({
      level: 'warning',
      nodeId: 'reply',
      at: { pointer: '/nodes/0/harness' },
      params: {
        node: 'reply',
        harness: 'cursor',
        available: ['claude-code', 'codex'],
      },
    });
    expect(skill).toMatchObject({
      at: { pointer: '/nodes/0/skills/1' },
      params: { node: 'reply', skill: 'tone-guide' },
    });
    expect(skill?.params).not.toHaveProperty('suggestion');
    expect(connector).toMatchObject({
      at: { pointer: '/nodes/0/connectors/1' },
      params: { node: 'reply', connector: 'gmail', catalogued: true },
    });
    expect(secret).toMatchObject({
      at: { pointer: '/nodes/0/secrets/1' },
      params: { node: 'reply', secret: 'CRM_TOKEN' },
    });
  });

  it('suggests the closest name it has, and names a connector the deployment has none by', async () => {
    const store = memoryStore({ orgFacts: FACTS });
    const { warnings } = await validate(
      agentDoc({ skills: ['reply-stlye'], connectors: ['githbu'] }),
      { store },
    );
    expect(warnings.map((w) => w.params)).toEqual([
      { node: 'reply', skill: 'reply-stlye', suggestion: 'reply-style' },
      {
        node: 'reply',
        connector: 'githbu',
        catalogued: false,
        suggestion: 'github',
      },
    ]);
  });

  it('warns about a capability step whose connector nobody connected, and only that', async () => {
    const store = memoryStore({ orgFacts: FACTS });
    const doc = {
      version: 1,
      name: 'crm/sync',
      nodes: [
        { id: 'lead', type: 'crm.create_lead', input: {} },
        { id: 'issue', type: 'github.create_issue', input: {} },
        // A platform capability needs no connection; a registered type
        // outside the catalog says nothing about one.
        { id: 'todo', type: 'task.create', input: {} },
        { id: 'weather', type: 'weather.current', input: {} },
      ],
      output: {
        lead: '{{ nodes.lead.output }}',
        issue: '{{ nodes.issue.output }}',
        todo: '{{ nodes.todo.output }}',
        weather: '{{ nodes.weather.output }}',
      },
    };
    const { warnings } = await validate(doc, { store });
    expect(
      warnings.filter((w) => w.code === 'CONNECTOR_NOT_CONNECTED'),
    ).toEqual([
      expect.objectContaining({
        nodeId: 'lead',
        at: { pointer: '/nodes/0/type' },
        params: { node: 'lead', connector: 'crm', catalogued: true },
      }),
    ]);
  });

  it('warns when the event trigger waits for an event Tale does not raise', async () => {
    const store = memoryStore({
      orgFacts: { raisedEvents: ['task.created', 'comment.created'] },
    });
    await store.setTrigger('support/reply', {
      kind: 'event',
      event: 'task.create',
    });
    const { warnings } = await validate(agentDoc({}), { store });
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'EVENT_UNKNOWN',
        at: { pointer: '' },
        params: { event: 'task.create', suggestion: 'task.created' },
      }),
    ]);

    await store.setTrigger('support/reply', {
      kind: 'event',
      event: 'task.created',
    });
    expect((await validate(agentDoc({}), { store })).warnings).toEqual([]);
  });

  it('warns about nothing it cannot tell: a fact left out, a failed lookup, a store without the seam', async () => {
    const named = agentDoc({
      harness: 'cursor',
      skills: ['tone-guide'],
      connectors: ['gmail'],
      secrets: ['CRM_TOKEN'],
    });
    // A member's agent: the host leaves the secret names out.
    const partial = memoryStore({
      orgFacts: { ...FACTS, secrets: undefined },
    });
    expect(
      codes((await validate(named, { store: partial })).warnings),
    ).not.toContain('SECRET_UNKNOWN');

    const failing = memoryStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = {
      ...failing,
      orgFacts: () => Promise.reject(new Error('database unreachable')),
    };
    expect((await validate(named, { store: broken })).warnings).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[engine] skipping the organization checks (store lookup failed):',
      'database unreachable',
    );
    warn.mockRestore();

    expect((await validate(named, { store: memoryStore() })).warnings).toEqual(
      [],
    );
    expect((await validate(named)).warnings).toEqual([]);
  });

  it('reads past an entry that names nothing yet: a template, a blank, a non-string', async () => {
    const store = memoryStore({ orgFacts: FACTS });
    const { warnings } = await validate(
      agentDoc({
        skills: ['{{ input.skill }}', '  '],
        harness: '{{ input.runtime }}',
      }),
      { store },
    );
    expect(warnings).toEqual([]);
  });
});

describe('orgFactsQuery', () => {
  const nodes = (doc: Record<string, unknown>) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixtures below are node lists
    doc.nodes as Parameters<typeof orgStateIssues>[0]['nodes'];

  it('asks only for what the document names', () => {
    const doc = agentDoc({ skills: ['reply-style'] });
    const query = orgFactsQuery({
      doc,
      nodes: nodes(doc),
      indexOf: () => 0,
    });
    expect(query).toEqual<OrgFactsQuery>({
      automation: 'support/reply',
      skills: true,
      connectors: false,
      secrets: false,
      harnesses: false,
      event: true,
    });
  });

  it('asks nothing of a nameless document that names nothing', () => {
    const doc = {
      nodes: [{ id: 'main', type: 'transform', code: 'return 1;' }],
    };
    expect(
      orgFactsQuery({ doc, nodes: nodes(doc), indexOf: () => 0 }),
    ).toBeNull();
  });
});
