import { describe, expect, it } from 'vitest';

import { MCP_TOOLS } from '@/lib/mcp/tools';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import { buildPrompt } from './prompts';

const TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));

const LOCALES = { en: enMessages, de: deMessages, fr: frMessages } as const;

/** A word that reads as a tool: lower-case parts joined by underscores. */
const TOOL_SHAPED = /\b[a-z]+(?:_[a-z]+)+\b/g;

function isTree(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The catalog's own text for a key of the `codingAgent` topic, with its
 * `{name}` filled in: what `useT('codingAgent')` hands the prompts. */
function translator(messages: Record<string, unknown>) {
  return (key: string, values: Record<string, string> = {}): string => {
    const found = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (isTree(node) ? node[part] : undefined),
        messages.codingAgent,
      );
    if (typeof found !== 'string') throw new Error(`No text for ${key}`);
    return found.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = values[name];
      if (value === undefined) throw new Error(`No value for {${name}}`);
      return value;
    });
  };
}

describe('buildPrompt', () => {
  it.each(Object.entries(LOCALES))(
    'names only tools the endpoint offers, in %s',
    (locale, messages) => {
      const t = translator(messages);
      for (const context of [
        { kind: 'general' },
        { kind: 'create' },
        { kind: 'edit', name: 'weekly-report' },
        { kind: 'run', name: 'weekly-report', runId: 'run-1' },
      ] as const) {
        const named = buildPrompt(t, context).match(TOOL_SHAPED) ?? [];
        // The prompts do name tools, and every one of them exists.
        expect(named.length, `${locale} ${context.kind}`).toBeGreaterThan(0);
        for (const tool of named) {
          expect(
            TOOL_NAMES.has(tool),
            `${locale} ${context.kind}: ${tool}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(Object.entries(LOCALES))(
    'names the automation in the edit prompt, in %s',
    (_locale, messages) => {
      const t = translator(messages);
      expect(buildPrompt(t, { kind: 'edit', name: 'weekly-report' })).toContain(
        'weekly-report',
      );
      expect(buildPrompt(t, { kind: 'general' })).not.toContain('{');
    },
  );

  it.each(Object.entries(LOCALES))(
    'names the run and the automation in the run prompt, in %s',
    (_locale, messages) => {
      const t = translator(messages);
      const prompt = buildPrompt(t, {
        kind: 'run',
        name: 'weekly-report',
        runId: 'run-1',
      });
      expect(prompt).toContain('weekly-report');
      expect(prompt).toContain('run-1');
      expect(prompt).not.toContain('{');
    },
  );

  it.each(Object.entries(LOCALES))(
    'leaves a bracketed place for what the person wants, in %s',
    (_locale, messages) => {
      const t = translator(messages);
      expect(buildPrompt(t, { kind: 'edit', name: 'x' })).toMatch(/\[[^\]]+\]/);
      expect(buildPrompt(t, { kind: 'create' })).toMatch(/\[[^\]]+\]/);
    },
  );

  // The dialog marks every bracketed part as one to replace and says so, so
  // a prompt that asks for nothing holds none.
  it.each(Object.entries(LOCALES))(
    'holds no bracketed part where the person has nothing to fill in, in %s',
    (_locale, messages) => {
      const t = translator(messages);
      for (const context of [
        { kind: 'general' },
        { kind: 'run', name: 'x', runId: 'run-1' },
      ] as const) {
        expect(buildPrompt(t, context)).not.toMatch(/\[[^\]]+\]/);
      }
    },
  );
});
