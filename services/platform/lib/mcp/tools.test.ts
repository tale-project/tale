import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, test } from 'vitest';

import { ENGINE_TOOL_ARGS } from './args';
import { toolJsonSchema } from './json-schema';
import {
  MCP_TOOL_GROUPS,
  MCP_TOOLS,
  type McpToolAnnotations,
  type McpToolGroup,
} from './tools';

/**
 * The inventory's grouping contract. The endpoint docs
 * (docs/en/develop/mcp-endpoint.md) and the API → MCP settings section present
 * the same groups, so membership is pinned by name here: a tool that
 * moves group, ships unclassified, or appears in the inventory without a docs
 * decision fails loudly instead of silently drifting the settings page away
 * from the docs tables. Names are listed in the advertised (`tools/list`)
 * order.
 */

const byGroup = (group: McpToolGroup) =>
  MCP_TOOLS.filter((tool) => tool.group === group).map((tool) => tool.name);

describe('MCP tool grouping', () => {
  test('group membership matches the endpoint docs tables', () => {
    expect(byGroup('authoring')).toEqual([
      'get_docs',
      'get_catalog',
      'search_catalog',
      'validate_automation',
      'run_automation',
      'test_automation',
      'save_automation',
      'get_automation',
      'list_automations',
      'deploy_automation',
      'delete_automation',
    ]);
    expect(byGroup('management')).toEqual([
      'set_trigger',
      'run_deployed',
      'start_run',
      'list_runs',
      'get_run',
      'cancel_run',
      'answer_run_ask',
      'list_versions',
      'set_automation_projects',
      'list_triggers',
      'delete_trigger',
      'get_automation_metrics',
    ]);
    expect(byGroup('discovery')).toEqual([
      'list_models',
      'list_harnesses',
      'list_skills',
      'list_connectors',
      'list_agent_secrets',
      'list_projects',
      'list_events',
    ]);
    expect(byGroup('capability')).toEqual([
      'search_capabilities',
      'invoke_capability',
      'get_knowledge',
    ]);
  });

  test('the groups partition the whole inventory', () => {
    expect(MCP_TOOL_GROUPS.flatMap(byGroup)).toHaveLength(MCP_TOOLS.length);
  });

  test('the advertised order keeps each group contiguous, in display order', () => {
    const transitions = MCP_TOOLS.map((tool) => tool.group).filter(
      (group, index, all) => group !== all[index - 1],
    );
    expect(transitions).toEqual([...MCP_TOOL_GROUPS]);
  });
});

/**
 * The annotations a host keys its trust decisions on, pinned tool by tool:
 * a read is `readOnlyHint: true` and nothing else; every tool that writes,
 * deletes, executes live or spends says so. A tool cannot enter the
 * inventory without a row here.
 */
describe('MCP tool annotations', () => {
  const hints = (
    readOnlyHint: boolean,
    destructiveHint: boolean,
    idempotentHint: boolean,
    openWorldHint: boolean,
  ): McpToolAnnotations => ({
    readOnlyHint,
    destructiveHint,
    idempotentHint,
    openWorldHint,
  });
  const READ = hints(true, false, false, false);
  const EXPECTED: Record<string, McpToolAnnotations> = {
    get_docs: { ...READ, idempotentHint: true },
    get_catalog: { ...READ, idempotentHint: true },
    search_catalog: { ...READ, idempotentHint: true },
    validate_automation: { ...READ, idempotentHint: true },
    run_automation: hints(false, false, true, false),
    test_automation: hints(false, false, true, false),
    save_automation: hints(false, false, false, false),
    get_automation: { ...READ, idempotentHint: true },
    list_automations: { ...READ, idempotentHint: true },
    deploy_automation: hints(false, true, true, false),
    delete_automation: hints(false, true, true, false),
    set_trigger: hints(false, true, true, false),
    run_deployed: hints(false, true, false, true),
    start_run: hints(false, true, false, true),
    list_runs: { ...READ, idempotentHint: true },
    get_run: { ...READ, idempotentHint: true },
    cancel_run: hints(false, true, true, false),
    answer_run_ask: hints(false, false, false, false),
    list_versions: { ...READ, idempotentHint: true },
    set_automation_projects: hints(false, true, true, false),
    list_triggers: { ...READ, idempotentHint: true },
    delete_trigger: hints(false, true, true, false),
    get_automation_metrics: { ...READ, idempotentHint: true },
    list_models: { ...READ, idempotentHint: true },
    list_harnesses: { ...READ, idempotentHint: true },
    list_skills: { ...READ, idempotentHint: true },
    list_connectors: { ...READ, idempotentHint: true },
    list_agent_secrets: { ...READ, idempotentHint: true },
    list_projects: { ...READ, idempotentHint: true },
    list_events: { ...READ, idempotentHint: true },
    search_capabilities: { ...READ, idempotentHint: true },
    invoke_capability: hints(false, true, false, true),
    get_knowledge: { ...READ, idempotentHint: true },
  };

  test('every tool carries all four hints, exactly as pinned', () => {
    const actual = Object.fromEntries(
      MCP_TOOLS.map((tool) => [tool.name, tool.annotations]),
    );
    expect(actual).toEqual(EXPECTED);
    for (const tool of MCP_TOOLS) {
      expect(Object.keys(tool.annotations).sort(), tool.name).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
    }
  });

  test('read-only is exactly the complement of the tools that write, execute or spend', () => {
    const mutating = new Set([
      'save_automation',
      'deploy_automation',
      'delete_automation',
      'answer_run_ask',
      'set_automation_projects',
      'set_trigger',
      'delete_trigger',
      'cancel_run',
      'run_deployed',
      'start_run',
      'invoke_capability',
      'run_automation',
      'test_automation',
    ]);
    for (const tool of MCP_TOOLS) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(
        !mutating.has(tool.name),
      );
    }
  });
});

/**
 * What a client does with an advertised input schema decides whether the
 * tool is usable at all: Claude Code drops a tool whose top-level property
 * names break `^[A-Za-z0-9_.-]{1,64}$` or whose schema fails the 2020-12
 * meta-schema, and flattens a root-level `anyOf`/`oneOf`/`allOf` (losing
 * the alternatives). Every schema is generated from the tool's zod
 * arguments, so these hold for every tool, present and future.
 */
describe('MCP tool input schemas', () => {
  const ajv = new Ajv2020({ strict: false });

  test.each(MCP_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s advertises a schema every client keeps',
    (_name, tool) => {
      const schema = toolJsonSchema(tool.args, 'input');
      expect(schema.type).toBe('object');
      expect(schema.$schema).toBeUndefined();
      for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
        expect(schema[combinator]).toBeUndefined();
      }
      // A typo is refused, never dropped.
      expect(schema.additionalProperties).toBe(false);
      const properties = Object.keys(
        (schema.properties ?? {}) as Record<string, unknown>,
      );
      for (const property of properties) {
        expect(property).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
      }
      expect(ajv.validateSchema(schema), JSON.stringify(ajv.errors)).toBe(true);
      expect(() => ajv.compile(schema)).not.toThrow();
    },
  );

  test('a schema and the check a call meets are one: what the schema refuses, the arguments refuse', () => {
    const schema = toolJsonSchema(ENGINE_TOOL_ARGS.get_automation, 'input');
    const validate = ajv.compile(schema);
    for (const args of [
      { name: 'billing/dunning' },
      { name: 'billing/dunning', version: 3 },
      { name: 'billing/dunning', version: 'deployed' },
      { name: '   ' },
      { name: 'x', version: 0 },
      { name: 'x', version: 'latest' },
      { name: 'x', extra: true },
      {},
    ]) {
      expect(
        ENGINE_TOOL_ARGS.get_automation.safeParse(args).success,
        JSON.stringify(args),
      ).toBe(validate(args));
    }
  });
});

/**
 * Who may call a tool and what it costs, pinned tool by tool: a tool cannot
 * enter the inventory, or change its bar or its budget, without a row here.
 */
describe('MCP tool roles and budgets', () => {
  test('only owners, admins and developers persist, rebind, start or stop live work', () => {
    expect(
      MCP_TOOLS.filter((tool) => tool.role === 'developer').map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'save_automation',
      'deploy_automation',
      'delete_automation',
      'set_trigger',
      'run_deployed',
      'cancel_run',
      'set_automation_projects',
      'delete_trigger',
    ]);
  });

  test('a start takes the developer bar only when it is live; a mock start is every member’s [MCP-R4]', () => {
    expect(
      MCP_TOOLS.filter((tool) => tool.role === 'live-developer').map(
        (tool) => tool.name,
      ),
    ).toEqual(['start_run']);
  });

  test('every tool that executes an automation draws from the execution budget', () => {
    expect(
      MCP_TOOLS.filter((tool) => tool.lane === 'execute').map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'run_automation',
      'test_automation',
      'deploy_automation',
      'run_deployed',
      'start_run',
      'invoke_capability',
    ]);
  });

  test('a read never draws from it', () => {
    for (const tool of MCP_TOOLS) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.lane, tool.name).toBe('api');
      }
    }
  });
});

/**
 * What an answer promises: every read tool states the shape of its answer
 * (a client validates against it), and no tool that acts does — what it
 * answers depends on what it did. The tools that put something live ask
 * the person first, whatever the client's permission mode.
 */
describe('MCP tool answers and client hints', () => {
  test('every read tool states its answer, and only read tools do', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.result !== null, tool.name).toBe(
        tool.annotations.readOnlyHint,
      );
    }
  });

  test('every stated answer is an object schema both validator generations accept', () => {
    const draft2020 = new Ajv2020({ strict: false });
    for (const tool of MCP_TOOLS) {
      if (tool.result === null) continue;
      const schema = toolJsonSchema(tool.result, 'output');
      expect(schema.type, tool.name).toBe('object');
      expect(schema.$schema, tool.name).toBeUndefined();
      expect(
        draft2020.validateSchema(schema),
        `${tool.name}: ${JSON.stringify(draft2020.errors)}`,
      ).toBe(true);
    }
  });

  test('putting a version live, deleting, installing, binding a trigger and answering for a person ask the person before every call', () => {
    expect(
      MCP_TOOLS.filter((tool) => tool.requiresUserInteraction).map(
        (tool) => tool.name,
      ),
    ).toEqual([
      'deploy_automation',
      'delete_automation',
      'set_trigger',
      'answer_run_ask',
      'set_automation_projects',
    ]);
    for (const tool of MCP_TOOLS) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.requiresUserInteraction, tool.name).toBe(false);
      }
    }
  });
});

/**
 * What a client keeps of an inventory: Cursor offers a model at most 40
 * tools across every server it connects, and Claude Code keeps the first
 * 2,048 characters of a description. A tool past the budget is a fold (two
 * tools into one) or a deferred switch, decided when it bites; a
 * description naming a tool the inventory does not hold sends the agent to
 * call it.
 */
describe('MCP inventory limits', () => {
  const TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));

  test('the inventory holds at most 40 tools', () => {
    expect(MCP_TOOLS.length).toBeLessThanOrEqual(40);
    expect(TOOL_NAMES.size).toBe(MCP_TOOLS.length);
  });

  test.each(MCP_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s describes itself in at most 2,048 characters, naming only tools that exist',
    (_name, tool) => {
      expect(tool.description.length).toBeLessThanOrEqual(2048);
      const named = tool.description.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
      expect(named.filter((word) => !TOOL_NAMES.has(word))).toEqual([]);
    },
  );
});
