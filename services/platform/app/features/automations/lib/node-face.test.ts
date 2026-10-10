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
