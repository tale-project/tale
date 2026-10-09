import { describe, expect, test } from 'vitest';

import {
  findMcpPrompt,
  MCP_PROMPTS,
  type McpPromptSpec,
  type PromptArgs,
  promptListing,
  promptsFor,
  promptText,
} from './prompts';
import { automationResourceUri, runResourceUri } from './resources';
import {
  isServedAddress,
  mentionedAddresses,
  toolLikeWords,
} from './test-helpers';
import { MCP_TOOLS } from './tools';

const INVENTORY = new Set(MCP_TOOLS.map((tool) => tool.name));

/** Every argument combination a prompt's lines branch on. */
const ARGUMENT_SETS: Readonly<Record<string, readonly PromptArgs[]>> = {
  edit_automation: [{}, { name: 'billing/dunning' }],
  debug_failed_run: [{ runId: 'run_42' }],
  add_trigger: [
    { name: 'billing/dunning' },
    { name: 'billing/dunning', kind: 'schedule' },
    { name: 'billing/dunning', kind: 'webhook' },
    { name: 'billing/dunning', kind: 'event' },
  ],
};

/** Each argument combination, with its attachments read and not read. */
function variants(prompt: McpPromptSpec): Array<{
  args: PromptArgs;
  embedded: ReadonlySet<string>;
}> {
  return (ARGUMENT_SETS[prompt.name] ?? [{}]).flatMap((args) => {
    const uris = prompt.embeds(args).map((embed) => embed.uri);
    return [
      { args, embedded: new Set<string>() },
      { args, embedded: new Set(uris) },
    ];
  });
}

describe('the prompts', () => {
  test('are the three the design names, in order', () => {
    expect(MCP_PROMPTS.map((prompt) => prompt.name)).toEqual([
      'edit_automation',
      'debug_failed_run',
      'add_trigger',
    ]);
  });

  test('advertise exactly the arguments their schema takes, with the same required flags', () => {
    for (const prompt of MCP_PROMPTS) {
      const shape = prompt.args.shape;
      expect(Object.keys(shape).sort(), prompt.name).toEqual(
        prompt.arguments.map((argument) => argument.name).sort(),
      );
      for (const argument of prompt.arguments) {
        expect(
          shape[argument.name]?.safeParse(undefined).success,
          `${prompt.name}.${argument.name}`,
        ).toBe(!argument.required);
      }
      expect(promptListing(prompt)).toEqual({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments,
      });
    }
  });

  test('take one word per argument, as Claude Code splits them', () => {
    const edit = findMcpPrompt('edit_automation');
    expect(edit?.args.safeParse({ name: 'billing/dunning' }).success).toBe(
      true,
    );
    expect(edit?.args.safeParse({ name: 'two words' }).success).toBe(false);
    expect(edit?.args.safeParse({ goal: 'x' }).success).toBe(false);
    const trigger = findMcpPrompt('add_trigger');
    expect(trigger?.args.safeParse({ name: 'a', kind: 'hourly' }).success).toBe(
      false,
    );
  });

  test('each line declares exactly the tools it names, and names only tools the inventory holds', () => {
    for (const prompt of MCP_PROMPTS) {
      for (const { args, embedded } of variants(prompt)) {
        for (const line of prompt.lines(args, embedded)) {
          expect(toolLikeWords(line.text), line.text).toEqual(
            [...line.tools].sort(),
          );
        }
        const text = promptText(prompt, args, embedded);
        expect(
          toolLikeWords(text).filter((word) => !INVENTORY.has(word)),
        ).toEqual([]);
      }
    }
  });

  test('name and attach only addresses the server reads', () => {
    for (const prompt of MCP_PROMPTS) {
      for (const { args, embedded } of variants(prompt)) {
        const text = promptText(prompt, args, embedded);
        expect(
          mentionedAddresses(text).filter((uri) => !isServedAddress(uri)),
          prompt.name,
        ).toEqual([]);
        for (const embed of prompt.embeds(args)) {
          expect(isServedAddress(embed.uri), embed.uri).toBe(true);
        }
      }
    }
  });

  test('attach the automation, the run or the reference they are about', () => {
    const name = 'billing/dunning';
    expect(findMcpPrompt('edit_automation')?.embeds({ name })).toEqual([
      { uri: automationResourceUri(name), required: false },
    ]);
    expect(findMcpPrompt('edit_automation')?.embeds({})).toEqual([]);
    expect(findMcpPrompt('debug_failed_run')?.embeds({ runId: 'r1' })).toEqual([
      { uri: runResourceUri('r1'), required: true },
    ]);
    expect(findMcpPrompt('add_trigger')?.embeds({ name })).toEqual([
      { uri: automationResourceUri(name), required: true },
      { uri: 'tale://docs/triggers', required: true },
    ]);
  });

  test('say plainly when the automation to edit could not be read', () => {
    const edit = findMcpPrompt('edit_automation');
    if (edit === undefined) throw new Error('edit_automation is listed');
    const name = 'billing/dunning';
    const found = promptText(
      edit,
      { name },
      new Set([automationResourceUri(name)]),
    );
    expect(found).toContain('Its latest version is attached');
    const missing = promptText(edit, { name }, new Set());
    expect(missing).toContain('There is no saved automation named');
    expect(missing).not.toContain('attached');
  });

  test('never let the agent deploy or set a trigger without the person', () => {
    const edit = findMcpPrompt('edit_automation');
    const trigger = findMcpPrompt('add_trigger');
    if (edit === undefined || trigger === undefined) {
      throw new Error('both prompts are listed');
    }
    expect(promptText(edit, {}, new Set())).toContain(
      'Do not deploy, set a trigger or change anything else until I say so',
    );
    expect(promptText(trigger, { name: 'a' }, new Set())).toContain(
      'ask me before you call set_trigger',
    );
  });

  test('a kind narrows add_trigger to its own advice', () => {
    const trigger = findMcpPrompt('add_trigger');
    if (trigger === undefined) throw new Error('add_trigger is listed');
    const webhook = promptText(
      trigger,
      { name: 'a', kind: 'webhook' },
      new Set(),
    );
    expect(webhook).toContain('For a webhook');
    expect(webhook).not.toContain('For a schedule');
    expect(webhook).not.toContain('list_events');
  });

  test('a prompt whose tools the inventory lacks is not listed, and a line naming a missing tool is left out', () => {
    const without = new Set(
      [...INVENTORY].filter((tool) => tool !== 'set_trigger'),
    );
    expect(promptsFor(without).map((prompt) => prompt.name)).toEqual([
      'edit_automation',
      'debug_failed_run',
    ]);
    const debug = findMcpPrompt('debug_failed_run');
    if (debug === undefined) throw new Error('debug_failed_run is listed');
    const noSecrets = new Set(
      [...INVENTORY].filter((tool) => tool !== 'list_agent_secrets'),
    );
    expect(
      promptText(debug, { runId: 'r1' }, new Set(), noSecrets),
    ).not.toContain('list_agent_secrets');
  });
});
