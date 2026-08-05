import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { searchCatalog } from '../engine/api/catalog-search';
import { agentDocs } from '../engine/api/docs';
import { execute } from '../engine/core/execute';
import { setCodeRunner } from '../engine/core/runner';
import { nodeTypes } from '../engine/core/slots';
import type { Automation } from '../engine/core/types';
import { validate } from '../engine/core/validate';
import { nodeVmRunner } from '../engine/runners/node-vm';
import { loadConnectors, nodeTypeFor } from './registry';

const SYSTEM_ROOT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../configs/platform/system',
);

let loaded: ReturnType<typeof loadConnectors>;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  loaded = loadConnectors(SYSTEM_ROOT);
});

describe('connector registry', () => {
  it('registers every shipped action as a node type', () => {
    expect(loaded.connectors).toHaveLength(17);
    const actionCount = loaded.connectors.reduce(
      (n, c) => n + c.actions.length,
      0,
    );
    expect(loaded.nodeTypes).toHaveLength(actionCount);
    // Node types are addressed as <connector>.<action>.
    expect(loaded.nodeTypes).toContain('github.create_issue');
    expect(loaded.nodeTypes).toContain('tavily.search');
    expect(loaded.nodeTypes).toContain('sandbox.run_script');
    // Platform capabilities are connectors too — the mail packs call this one.
    expect(loaded.nodeTypes).toContain('conversation.sync_mailbox');
    expect(loaded.nodeTypes).toContain('conversation.list_mailbox_messages');
  });

  it('exposes each action to the engine with its schema and signature', () => {
    const def = nodeTypes().get(nodeTypeFor('github', 'create_issue'));
    expect(def?.kind).toBe('connector');
    expect(def?.outputKind).toBe('structured');
    expect(def?.connector?.inputSchema).toMatchObject({ type: 'object' });
    expect(def?.connector?.outputSignature).toContain('number');
  });

  it('marks write actions as effectful and read actions as not', () => {
    expect(
      nodeTypes().get(nodeTypeFor('github', 'create_issue'))?.connector
        ?.hasEffect,
    ).toBe(true);
    expect(
      nodeTypes().get(nodeTypeFor('tavily', 'search'))?.connector?.hasEffect,
    ).toBe(false);
  });

  it('refuses a connector whose name disagrees with its directory', () => {
    expect(() =>
      loadConnectors(
        path.join(
          path.dirname(new URL(import.meta.url).pathname),
          'testdata/mismatched',
        ),
      ),
    ).toThrow(/declares name/);
  });

  describe('an automation can actually run a registered action', () => {
    const automation: Automation = {
      version: 1,
      name: 'research',
      inputs: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
      },
      nodes: [
        {
          id: 'search',
          type: 'tavily.search',
          input: { query: '{{ input.topic }}' },
        },
      ],
      output: { hits: '{{ nodes.search.output.results }}' },
    };

    it('validates against the registered schema', async () => {
      const { errors } = await validate(automation);
      expect(errors).toEqual([]);
    });

    it('executes the YAML mock body through the code runner', async () => {
      const result = await execute(automation, {
        input: { topic: 'retrieval augmented generation' },
        mode: 'mock',
      });
      expect(result.status).toBe('success');
      const output = result.output as { hits: Array<{ title: string }> };
      // The mock is deterministic and derives from the input, so the search
      // term reaches the connector body rather than a canned constant.
      expect(output.hits[0]?.title).toContain('retrieval augmented generation');
    });

    it('records an effect for a write action', async () => {
      const result = await execute(
        {
          version: 1,
          name: 'file-issue',
          nodes: [
            {
              id: 'issue',
              type: 'github.create_issue',
              input: { owner: 'tale', repo: 'tale', title: 'Bug report' },
            },
          ],
          output: '{{ nodes.issue.output }}',
        },
        { input: {}, mode: 'mock' },
      );
      expect(result.status).toBe('success');
      expect(result.effects).toHaveLength(1);
      expect(result.effects[0]).toMatchObject({
        node: 'issue',
        connector: 'github.create_issue',
      });
    });
  });
});

describe('registered actions are discoverable', () => {
  it('search_catalog finds a connector action by capability words', () => {
    // Capability discovery goes through search rather than an inline dump, so
    // a newly registered connector must be reachable by the words an author
    // would actually type.
    const names = searchCatalog('search the web').map((m) => m.type);
    expect(names).toContain('tavily.search');

    const issue = searchCatalog('create issue').map((m) => m.type);
    expect(issue).toContain('github.create_issue');
  });

  it('the generated agent docs list registered connector actions', () => {
    const docs = agentDocs();
    expect(docs).toContain('tavily.search');
  });
});
