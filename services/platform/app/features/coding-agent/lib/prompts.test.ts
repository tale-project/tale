import { describe, expect, it } from 'vitest';

import { findMcpTool, MCP_TOOLS } from '@/lib/mcp/tools';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import { buildPrompt } from './prompts';

const TOOL_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name));

const LOCALES = { en: enMessages, de: deMessages, fr: frMessages } as const;

/** A new automation in a project, once its name is read and before. */
const IN_PROJECT = {
  kind: 'create',
  project: { id: 'k57project', name: 'Website relaunch' },
} as const;
const IN_PROJECT_BY_ID = {
  kind: 'create',
  project: { id: 'k57project' },
} as const;

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
        IN_PROJECT,
        IN_PROJECT_BY_ID,
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
    'names the project and hands the agent its ID in the create prompt, in %s',
    (_locale, messages) => {
      const t = translator(messages);
      const withName = buildPrompt(t, IN_PROJECT);
      // The name for the person who reads it; the ID, in the sentence that
      // sets save_automation's projectId, for the agent.
      expect(withName).toContain('Website relaunch');
      expect(withName).toMatch(/\bprojectId\b[^.]*\bk57project\b/);
      expect(withName).toContain('save_automation');
      expect(withName).not.toContain('{');
      // Until the name is read, the ID alone names the project.
      const byId = buildPrompt(t, IN_PROJECT_BY_ID);
      expect(byId).toMatch(/\bprojectId\b[^.]*\bk57project\b/);
      expect(byId).not.toContain('Website relaunch');
      expect(byId).not.toContain('{');
      // Without a project, the prompt names none.
      expect(buildPrompt(t, { kind: 'create' })).not.toContain('projectId');
    },
  );

  // The prompt names save_automation's own arguments, so a renamed one
  // cannot leave it asking for an argument that no longer exists.
  it('names arguments save_automation takes', () => {
    expect(
      Object.keys(findMcpTool('save_automation')?.args.shape ?? {}),
    ).toEqual(expect.arrayContaining(['create', 'projectId']));
  });

  it.each(Object.entries(LOCALES))(
    'leaves a bracketed place for what the person wants, in %s',
    (_locale, messages) => {
      const t = translator(messages);
      expect(buildPrompt(t, { kind: 'edit', name: 'x' })).toMatch(/\[[^\]]+\]/);
      expect(buildPrompt(t, { kind: 'create' })).toMatch(/\[[^\]]+\]/);
      expect(buildPrompt(t, IN_PROJECT)).toMatch(/\[[^\]]+\]/);
      expect(buildPrompt(t, IN_PROJECT_BY_ID)).toMatch(/\[[^\]]+\]/);
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
