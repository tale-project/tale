import { describe, expect, test } from 'vitest';

import { ENGINE_TOOL_ARGS } from './args';
import { MCP_DOC_TOPICS } from './docs/topics';
import {
  automationResourceUri,
  CATALOG_KINDS,
  MCP_RESOURCE_TEMPLATES,
  MCP_STATIC_RESOURCES,
  resourceFreshnessMs,
  resourceTarget,
  runResourceUri,
} from './resources';
import { findMcpTool } from './tools';

describe('the resource addresses', () => {
  test('list one reference per get_docs topic, then one catalog entry per get_catalog kind', () => {
    expect(MCP_STATIC_RESOURCES.map((resource) => resource.uri)).toEqual([
      ...MCP_DOC_TOPICS.map((topic) => `tale://docs/${topic}`),
      ...CATALOG_KINDS.map((kind) => `tale://catalog/${kind}`),
    ]);
    // The tool's own kinds, so the two can never list different ones.
    expect(ENGINE_TOOL_ARGS.get_catalog.shape.kind.unwrap().options).toEqual([
      ...CATALOG_KINDS,
    ]);
    expect(ENGINE_TOOL_ARGS.get_docs.shape.topic.unwrap().options).toEqual([
      ...MCP_DOC_TOPICS,
    ]);
  });

  test('every fixed resource and every template reads through a tool the inventory holds', () => {
    for (const resource of MCP_STATIC_RESOURCES) {
      const target = resourceTarget(resource.uri);
      expect('problem' in target, resource.uri).toBe(false);
      if ('problem' in target) continue;
      expect(findMcpTool(target.tool), resource.uri).toBeDefined();
      expect(target.mimeType).toBe(resource.mimeType);
      // The arguments are ones the tool takes.
      expect(
        findMcpTool(target.tool)?.args.safeParse(target.args).success,
        resource.uri,
      ).toBe(true);
    }
    for (const template of MCP_RESOURCE_TEMPLATES) {
      const filled = template.uriTemplate
        .replace('{name}', 'billing%2Fdunning')
        .replace('{version}', '3')
        .replace('{runId}', 'run_1');
      const target = resourceTarget(filled);
      expect('problem' in target, template.uriTemplate).toBe(false);
      if ('problem' in target) continue;
      expect(findMcpTool(target.tool), template.uriTemplate).toBeDefined();
      expect(target.mimeType).toBe(template.mimeType);
    }
  });

  test('a reference reads as markdown through get_docs, the catalog as JSON through get_catalog', () => {
    expect(resourceTarget('tale://docs/triggers')).toEqual({
      tool: 'get_docs',
      args: { topic: 'triggers' },
      mimeType: 'text/markdown',
      textField: 'docs',
    });
    expect(resourceTarget('tale://catalog/agent')).toEqual({
      tool: 'get_catalog',
      args: { kind: 'agent' },
      mimeType: 'application/json',
    });
    // The connector catalog runs past 100 KB with its schemas; the resource
    // lists the actions, get_catalog has the rest.
    expect(resourceTarget('tale://catalog/connector')).toMatchObject({
      args: { kind: 'connector', compact: true },
    });
  });

  test('an automation reads by its percent-encoded name, a version by number or as deployed', () => {
    expect(automationResourceUri('billing/dunning')).toBe(
      'tale://automations/billing%2Fdunning',
    );
    expect(resourceTarget(automationResourceUri('billing/dunning'))).toEqual({
      tool: 'get_automation',
      args: { name: 'billing/dunning' },
      mimeType: 'application/json',
    });
    expect(
      resourceTarget(automationResourceUri('billing/dunning', 7)),
    ).toMatchObject({ args: { name: 'billing/dunning', version: 7 } });
    expect(
      resourceTarget(automationResourceUri('billing/dunning', 'deployed')),
    ).toMatchObject({ args: { name: 'billing/dunning', version: 'deployed' } });
    // Typed with its "/" left raw, the name still reads, and a trailing
    // versions segment is the version.
    expect(resourceTarget('tale://automations/billing/dunning')).toMatchObject({
      args: { name: 'billing/dunning' },
    });
    expect(
      resourceTarget('tale://automations/billing/dunning/versions/3'),
    ).toMatchObject({ args: { name: 'billing/dunning', version: 3 } });
    // Encoded, a name that itself holds "versions" is never mistaken.
    expect(
      resourceTarget(automationResourceUri('ops/versions/3')),
    ).toMatchObject({ args: { name: 'ops/versions/3' } });
  });

  test('a run reads by its id', () => {
    expect(resourceTarget(runResourceUri('run_123'))).toEqual({
      tool: 'get_run',
      args: { runId: 'run_123' },
      mimeType: 'application/json',
    });
  });

  test('an address it does not serve is unknown; a served one with a part that cannot be one is invalid', () => {
    for (const uri of [
      'https://example.test/x',
      'tale://docs/billing',
      'tale://catalog/connectors',
      'tale://projects/p1',
      'tale://docs/',
    ]) {
      expect(resourceTarget(uri), uri).toEqual({ problem: 'unknown' });
    }
    for (const uri of [
      'tale://automations/billing/versions/x',
      'tale://automations/billing/versions/0',
      'tale://automations/%E0%A4%A',
      'tale://runs/%20',
    ]) {
      expect(resourceTarget(uri), uri).toEqual({ problem: 'invalid' });
    }
  });
});

describe('how long a client may keep a read, on 2026-07-28 [MCP-R26]', () => {
  test('a reference and a core node kind for an hour, the connector catalog for a minute', () => {
    for (const topic of MCP_DOC_TOPICS) {
      expect(resourceFreshnessMs(`tale://docs/${topic}`), topic).toBe(
        3_600_000,
      );
    }
    for (const kind of CATALOG_KINDS) {
      expect(resourceFreshnessMs(`tale://catalog/${kind}`), kind).toBe(
        kind === 'connector' ? 60_000 : 3_600_000,
      );
    }
  });

  test('an automation, one of its versions and a run not at all — an agent reads again after its own save', () => {
    for (const uri of [
      automationResourceUri('billing/dunning'),
      automationResourceUri('billing/dunning', 3),
      automationResourceUri('billing/dunning', 'deployed'),
      runResourceUri('run_1'),
      'tale://projects/p1',
      'tale://automations/billing/versions/x',
    ]) {
      expect(resourceFreshnessMs(uri), uri).toBe(0);
    }
  });
});
