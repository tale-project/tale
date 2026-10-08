import { describe, expect, test } from 'vitest';

import {
  buildInstructions,
  INSTRUCTION_FRAGMENTS,
  type InstructionFragment,
  SERVER_INSTRUCTIONS,
} from './instructions';
import {
  isServedAddress,
  mentionedAddresses,
  toolLikeWords,
} from './test-helpers';
import { MCP_TOOLS } from './tools';

/**
 * The lines the instructions gain once the settings tools, agent requests
 * and subscriptions ship, as long as they are planned to be. A client keeps
 * only the first 2,048 characters, so the limit holds for the full set: the
 * text today leaves their room, and none of them has to cut it to land. A
 * line moves into `INSTRUCTION_FRAGMENTS`, with its final words, together
 * with its tools.
 */
const LATER_FRAGMENTS: readonly InstructionFragment[] = [
  {
    text: "Settings: get_settings -> plan_settings -> show the plan -> apply_settings with each resource's expected hash.",
    tools: ['get_settings', 'plan_settings', 'apply_settings'],
  },
  {
    text: 'Never ask for, accept or print a secret (API keys, tokens, passwords). A change that needs one returns a link where the person finishes it in Tale; poll get_agent_request.',
    tools: ['get_agent_request'],
  },
  {
    text: "To run this organization's agents on your own subscription, call add_subscription and send the person its confirmUrl; never read another person's credentials.",
    tools: ['add_subscription'],
  },
];

describe('the server instructions', () => {
  test('leave room for the lines the later tools bring: the full set fits in 2,048 characters', () => {
    const everyTool = new Set([
      ...MCP_TOOLS.map((tool) => tool.name),
      ...LATER_FRAGMENTS.flatMap((fragment) => fragment.tools),
    ]);
    const full = buildInstructions(everyTool, [
      ...INSTRUCTION_FRAGMENTS,
      ...LATER_FRAGMENTS,
    ]);
    // Every later line is in the full text, so none was dropped to fit.
    for (const fragment of LATER_FRAGMENTS) {
      expect(full).toContain(fragment.text);
    }
    expect(full.length).toBeLessThanOrEqual(2048);
    // None of them ships before its tools exist.
    for (const fragment of LATER_FRAGMENTS) {
      expect(SERVER_INSTRUCTIONS).not.toContain(fragment.text);
    }
  });

  test('fit what clients keep: 2,048 characters, a self-contained first paragraph of at most 512', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2048);
    const [opening] = SERVER_INSTRUCTIONS.split('\n\n');
    expect(opening?.length ?? 0).toBeLessThanOrEqual(512);
    expect(opening).toMatch(/\.$/);
  });

  test('are plain ASCII — some clients mangle typography', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/^[\x20-\x7e\n]*$/);
  });

  test('name only tools the inventory holds and addresses the server reads', () => {
    const tools = new Set(MCP_TOOLS.map((tool) => tool.name));
    expect(
      toolLikeWords(SERVER_INSTRUCTIONS).filter((word) => !tools.has(word)),
    ).toEqual([]);
    // Every `tale://` address they name is one the server reads.
    expect(
      mentionedAddresses(SERVER_INSTRUCTIONS).filter(
        (address) => !isServedAddress(address),
      ),
    ).toEqual([]);
  });

  test('every fragment declares exactly the tools it names', () => {
    for (const fragment of [...INSTRUCTION_FRAGMENTS, ...LATER_FRAGMENTS]) {
      expect(toolLikeWords(fragment.text), fragment.text).toEqual(
        [...fragment.tools].sort(),
      );
    }
  });

  test('leave out a fragment whose tool the inventory does not hold', () => {
    const text = buildInstructions(new Set(['get_docs']), [
      { text: 'Opening.', tools: [] },
      { text: 'Read get_docs.', tools: ['get_docs'] },
      { text: 'Then call a_later_tool.', tools: ['a_later_tool'] },
    ]);
    expect(text).toBe('Opening.\n\nRead get_docs.');
  });

  test('teach the loop: read, check, try on the mocks, test, save, and ask before going live', () => {
    for (const step of [
      'get_automation',
      'validate_automation',
      'run_automation',
      'test_automation',
      'save_automation',
      'Ask the person before deploy_automation',
    ]) {
      expect(SERVER_INSTRUCTIONS).toContain(step);
    }
  });
});
