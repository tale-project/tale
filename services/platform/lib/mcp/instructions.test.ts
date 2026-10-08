import { describe, expect, test } from 'vitest';

import {
  buildInstructions,
  INSTRUCTION_FRAGMENTS,
  SERVER_INSTRUCTIONS,
} from './instructions';
import { MCP_TOOLS } from './tools';

/** The snake_case words a text uses — the shape every tool name has. */
function toolLikeWords(text: string): string[] {
  return [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].sort();
}

describe('the server instructions', () => {
  test('fit what clients keep: 2,048 characters, a self-contained first paragraph of at most 512', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2048);
    const [opening] = SERVER_INSTRUCTIONS.split('\n\n');
    expect(opening?.length ?? 0).toBeLessThanOrEqual(512);
    expect(opening).toMatch(/\.$/);
  });

  test('are plain ASCII — some clients mangle typography', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/^[\x20-\x7e\n]*$/);
  });

  test('name only tools the inventory holds', () => {
    const tools = new Set(MCP_TOOLS.map((tool) => tool.name));
    expect(
      toolLikeWords(SERVER_INSTRUCTIONS).filter((word) => !tools.has(word)),
    ).toEqual([]);
    // No resource exists yet, so no `tale://` address may be named.
    expect(SERVER_INSTRUCTIONS).not.toContain('tale://');
  });

  test('every fragment declares exactly the tools it names', () => {
    for (const fragment of INSTRUCTION_FRAGMENTS) {
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
