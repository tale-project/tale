import { Bot, Braces, CircleHelp, Sparkles, Workflow } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import type { NodeDef } from '@/lib/engine/core/types';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { mergeNodeTypes } from '../hooks/backend';
import {
  catalogLabel,
  nodeCatalogView,
  nodeFace,
  nodeIcon,
  nodeTitle,
  servedModelLabel,
  type NodeFaceContext,
} from './node-face';

/**
 * What a node's box says about the node itself: its title, its kind in
 * words (a connector's action in the reader's language), its icon, what it
 * returns, and the marks that change how it behaves.
 */

const CATALOG = nodeCatalogView(
  mergeNodeTypes([
    {
      type: 'github.list_issues',
      kind: 'connector',
      description: 'List issues',
      allowedFields: ['input'],
      requiredFields: [],
      outputKind: 'structured',
      connector: 'github',
      title: 'List issues',
      i18n: {
        de: { title: 'Issues auflisten' },
        fr: { title: 'Lister les tickets' },
      },
    },
    {
      type: 'tasks.update_status',
      kind: 'connector',
      description: 'Update status',
      allowedFields: ['input'],
      requiredFields: [],
      outputKind: 'structured',
      hasEffect: true,
      connector: 'tasks',
      title: 'Change task status',
      i18n: { de: { title: 'Aufgabenstatus ändern' } },
    },
  ]),
  [
    { name: 'github', displayName: 'GitHub', iconUrl: 'data:image/svg+xml,x' },
    {
      name: 'tasks',
      displayName: 'Tasks',
      i18n: { de: { displayName: 'Aufgaben' } },
    },
  ],
);

function ctx(
  locale = 'en',
  extra: Partial<NodeFaceContext> = {},
): NodeFaceContext {
  return {
    t: i18n.getFixedT(locale, 'automations'),
    locale,
    catalog: CATALOG,
    returns: { status: 'off', outputs: null },
    ...extra,
  };
}

const node = (def: Partial<NodeDef> & { id: string; type: string }) =>
  def as NodeDef;

describe('nodeTitle', () => {
  it('reads an id as words with a capital', () => {
    expect(nodeTitle('open_issues')).toBe('Open issues');
    expect(nodeTitle('a')).toBe('A');
  });
});

describe('catalogLabel', () => {
  it('names a connector action by its connector and title', () => {
    const issues = node({ id: 'issues', type: 'github.list_issues' });
    expect(catalogLabel(issues, ctx())).toBe('GitHub · List issues');
    expect(catalogLabel(issues, ctx('de'))).toBe('GitHub · Issues auflisten');
    expect(catalogLabel(issues, ctx('fr'))).toBe('GitHub · Lister les tickets');
    // A regional language falls back to its base language.
    expect(catalogLabel(issues, ctx('de-CH'))).toBe(
      'GitHub · Issues auflisten',
    );
  });

  it('translates a connector named with ordinary words', () => {
    const update = node({ id: 'mark', type: 'tasks.update_status' });
    expect(catalogLabel(update, ctx('de'))).toBe(
      'Aufgaben · Aufgabenstatus ändern',
    );
  });

  it('falls back to the action id in words when the catalog has no title', () => {
    expect(
      catalogLabel(node({ id: 'x', type: 'slack.post_message' }), ctx()),
    ).toBe('slack · Post message');
  });

  it('names the core types, with the model a model node calls', () => {
    expect(catalogLabel(node({ id: 'x', type: 'transform' }), ctx())).toBe(
      'Transform',
    );
    expect(
      catalogLabel(
        node({ id: 'x', type: 'llm', model: 'anthropic/claude-haiku-4-5' }),
        ctx('en', { modelLabel: () => 'Claude Haiku 4.5' }),
      ),
    ).toBe('Language model · Claude Haiku 4.5');
    expect(
      catalogLabel(node({ id: 'x', type: 'agent', model: 'gpt-5' }), ctx('de')),
    ).toBe('Agent · gpt-5');
    expect(
      catalogLabel(
        node({
          id: 'x',
          type: 'subautomation',
          automation: 'billing/send_dunning',
        }),
        ctx(),
      ),
    ).toBe('Calls send dunning');
    expect(catalogLabel(node({ id: 'x', type: 'subautomation' }), ctx())).toBe(
      'Calls an automation',
    );
    expect(catalogLabel(node({ id: 'x', type: 'mystery' }), ctx())).toBe(
      'Unknown type mystery',
    );
  });

  it("names a pinned agent's model by its provider when another provider serves it", () => {
    const apiKey = { authMethod: 'api-key' } as const;
    const named = ctx('en', {
      modelLabel: servedModelLabel({
        models: [
          {
            id: 'claude-sonnet-5',
            label: 'Claude Sonnet 5',
            providerSlug: 'anthropic',
            providerLabel: 'Anthropic',
            credential: apiKey,
          },
          {
            id: 'claude-sonnet-5',
            label: 'Claude Sonnet 5',
            providerSlug: 'eu-gateway',
            providerLabel: 'EU Gateway',
            credential: apiKey,
          },
          {
            id: 'claude-haiku-4-5',
            label: 'Claude Haiku 4.5',
            providerSlug: 'anthropic',
            providerLabel: 'Anthropic',
            credential: apiKey,
          },
        ],
        harnesses: [{ harness: 'claude-code', toolCallingWire: 'anthropic' }],
      }),
    });
    const agent = (model: string, modelProvider?: string, harness?: string) =>
      node({
        id: 'x',
        type: 'agent',
        model,
        ...(modelProvider !== undefined ? { modelProvider } : {}),
        ...(harness !== undefined ? { harness } : {}),
      });
    expect(catalogLabel(agent('claude-sonnet-5', 'eu-gateway'), named)).toBe(
      'Agent · EU Gateway · Claude Sonnet 5',
    );
    expect(catalogLabel(agent('claude-sonnet-5', 'anthropic'), named)).toBe(
      'Agent · Anthropic · Claude Sonnet 5',
    );
    // One provider serves it: the model's own name.
    expect(catalogLabel(agent('claude-haiku-4-5', 'anthropic'), named)).toBe(
      'Agent · Claude Haiku 4.5',
    );
    // The run picks the provider of an `llm` step and of an agent pinned
    // to none, so neither names one.
    expect(
      catalogLabel(
        node({ id: 'x', type: 'llm', model: 'claude-sonnet-5' }),
        named,
      ),
    ).toBe('Language model · Claude Sonnet 5');
    expect(catalogLabel(agent('claude-sonnet-5'), named)).toBe(
      'Agent · Claude Sonnet 5',
    );
    // A model no provider serves keeps the id as written.
    expect(catalogLabel(agent('gone-model', 'anthropic'), named)).toBe(
      'Agent · gone-model',
    );
    expect(
      catalogLabel(node({ id: 'x', type: 'llm', model: 'gone-model' }), named),
    ).toBe('Language model · gone-model');
  });

  it("names a pinned agent's model among the models its runtime is offered", () => {
    // OpenAI's Luna rides a subscription bound to Codex; OpenRouter's reads
    // alike under another id, and every runtime is offered it.
    const named = ctx('en', {
      modelLabel: servedModelLabel({
        models: [
          {
            id: 'gpt-5.6-luna',
            label: 'GPT 5.6 Luna',
            providerSlug: 'openai',
            providerLabel: 'OpenAI',
            credential: {
              authMethod: 'subscription-key',
              constraints: { harness: 'codex' },
            },
          },
          {
            id: 'openai/gpt-5.6-luna',
            label: 'GPT 5.6 Luna',
            providerSlug: 'openrouter',
            providerLabel: 'OpenRouter',
            credential: { authMethod: 'api-key' },
          },
        ],
        harnesses: [
          { harness: 'claude-code', toolCallingWire: 'anthropic' },
          { harness: 'codex', toolCallingWire: 'openai-responses' },
        ],
      }),
    });
    const agent = (harness?: string) =>
      node({
        id: 'x',
        type: 'agent',
        model: 'openai/gpt-5.6-luna',
        modelProvider: 'openrouter',
        ...(harness !== undefined ? { harness } : {}),
      });
    // The default runtime, Claude Code, is offered OpenRouter's alone.
    expect(catalogLabel(agent(), named)).toBe('Agent · GPT 5.6 Luna');
    expect(catalogLabel(agent('codex'), named)).toBe(
      'Agent · OpenRouter · GPT 5.6 Luna',
    );
    // A pick its runtime is not offered still names its own provider.
    expect(
      catalogLabel(
        node({
          id: 'x',
          type: 'agent',
          model: 'gpt-5.6-luna',
          modelProvider: 'openai',
        }),
        named,
      ),
    ).toBe('Agent · OpenAI · GPT 5.6 Luna');
  });
});

describe('nodeIcon', () => {
  it('draws core types with their own glyph and connectors with their icon', () => {
    expect(nodeIcon(node({ id: 'x', type: 'transform' }), CATALOG)).toBe(
      Braces,
    );
    expect(nodeIcon(node({ id: 'x', type: 'llm' }), CATALOG)).toBe(Sparkles);
    expect(nodeIcon(node({ id: 'x', type: 'agent' }), CATALOG)).toBe(Bot);
    expect(nodeIcon(node({ id: 'x', type: 'subautomation' }), CATALOG)).toBe(
      Workflow,
    );
    expect(nodeIcon(node({ id: 'x', type: 'mystery' }), CATALOG)).toBe(
      CircleHelp,
    );
    const github = nodeIcon(
      node({ id: 'x', type: 'github.list_issues' }),
      CATALOG,
    );
    // One component per icon, so a box keeps its loaded image.
    expect(
      nodeIcon(node({ id: 'y', type: 'github.list_issues' }), CATALOG),
    ).toBe(github);
  });
});

describe('nodeFace', () => {
  it('reserves the returns row until the check answers, then shows the shape', () => {
    const issues = node({ id: 'issues', type: 'github.list_issues' });
    expect(
      nodeFace(issues, ctx('en', { returns: { status: 'off', outputs: null } }))
        .returns,
    ).toBeUndefined();
    expect(
      nodeFace(
        issues,
        ctx('en', { returns: { status: 'pending', outputs: null } }),
      ).returns,
    ).toBeNull();
    const ready = nodeFace(
      issues,
      ctx('en', {
        returns: {
          status: 'ready',
          outputs: {
            issues: {
              type: 'object',
              properties: {
                issues: { type: 'array', items: { type: 'object' } },
              },
              required: ['issues'],
            },
          },
        },
      }),
    );
    expect(ready.returns).toEqual({
      text: '{ issues: Array<object> }',
      code: true,
    });
    expect(ready.sentences).toContain('Returns { issues: Array<object> }');
    expect(
      nodeFace(
        issues,
        ctx('en', { returns: { status: 'ready', outputs: { issues: {} } } }),
      ).returns,
    ).toEqual({ text: 'Shape known after a run', code: false });
  });

  it('marks a write, a question, an unpinned model and a tolerated failure', () => {
    const write = nodeFace(
      node({ id: 'mark', type: 'tasks.update_status', onError: 'continue' }),
      ctx(),
    );
    expect(write.chips).toEqual([
      { id: 'onError', label: 'Continues on error', tone: 'error' },
    ]);
    expect(write.markers.map((marker) => marker.label)).toEqual([
      'Changes data in Tasks. A live run may wait for approval.',
    ]);
    const agent = nodeFace(
      node({ id: 'helper', type: 'agent', model: 'gpt-5' }),
      ctx(),
    );
    expect(agent.markers.map((marker) => marker.id)).toEqual([
      'asks',
      'unpinnedModel',
    ]);
    expect(agent.sentences).toEqual([
      'May ask a question and wait for the answer.',
      'No pinned provider — each run picks one automatically.',
    ]);
  });
});

describe('a write allowed without approval [APV-R13]', () => {
  const mark = node({ id: 'mark', type: 'tasks.update_status' });

  it('says so on its box, in a chip and in its sentence', () => {
    const face = nodeFace(
      mark,
      ctx('en', { allowedWrites: new Set(['tasks.update_status']) }),
    );
    expect(face.chips).toContainEqual({
      id: 'allowed',
      label: 'Runs without approval',
      tone: 'info',
    });
    expect(face.markers.find((marker) => marker.id === 'writes')?.label).toBe(
      'Changes data in Tasks, without approval — an owner or admin allowed it.',
    );
  });

  it('keeps the plain write mark for a write that asks', () => {
    const face = nodeFace(mark, ctx('en', { allowedWrites: new Set() }));
    expect(face.chips.some((chip) => chip.id === 'allowed')).toBe(false);
    expect(face.markers.find((marker) => marker.id === 'writes')?.label).toBe(
      'Changes data in Tasks. A live run may wait for approval.',
    );
  });
});
