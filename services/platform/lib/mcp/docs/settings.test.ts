// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';

import { FILE_POLICY_TYPES } from '@tale/shared/schemas/governance';
import {
  GOVERNANCE_KEYS_NOT_OVER_MCP,
  SETTINGS_EFFECTS,
  SETTINGS_KINDS,
} from '@tale/shared/schemas/settings-kinds';
import { describe, expect, test } from 'vitest';

import { MCP_TOOLS } from '../tools';
import { settingsReference } from './settings';

const text = settingsReference();

/** Every source a settings refusal is raised in: the settings tools and
 * each kind's handler beside its writer. */
function settingsSources(): string {
  const domains = new URL('../../../backend/domains/', import.meta.url);
  const handlers = readdirSync(domains, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => new URL(`${entry.name}/settings-resource.ts`, domains))
    .flatMap((file) => {
      try {
        return [readFileSync(file, 'utf8')];
      } catch (error) {
        if (Reflect.get(Object(error), 'code') === 'ENOENT') return [];
        throw error;
      }
    });
  const tools = readdirSync(new URL('mcp/settings/', domains))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) =>
      readFileSync(new URL(`mcp/settings/${name}`, domains), 'utf8'),
    );
  return [...handlers, ...tools].join('\n');
}

describe('the settings reference', () => {
  test('describes every kind, in apply order, with its config', () => {
    const headings = [...text.matchAll(/^### (\S+)$/gm)].map(
      (match) => match[1],
    );
    expect(headings).toEqual(SETTINGS_KINDS.map((entry) => entry.kind));
    expect(text.match(/^```json$/gm)?.length ?? 0).toBeGreaterThanOrEqual(
      SETTINGS_KINDS.length,
    );
  });

  test('names every policy the governance kind takes, and why the others are not', () => {
    for (const key of FILE_POLICY_TYPES) {
      if (Object.hasOwn(GOVERNANCE_KEYS_NOT_OVER_MCP, key)) {
        expect(text, key).toContain(`- \`${key}\` `);
      } else {
        expect(text, key).toContain(`- \`${key}\`\n`);
      }
    }
  });

  test('says what every effect of a plan means, with its risk', () => {
    for (const [effect, risk] of Object.entries(SETTINGS_EFFECTS)) {
      expect(text).toContain(`| ${effect} | ${risk} |`);
    }
  });

  test('lists every refusal a settings handler raises, and only codes one does', () => {
    const sources = settingsSources();
    const raised = new Set(
      [
        ...sources.matchAll(
          /(?:SettingsRefusalError|ConfigurationError)\(\s*'([A-Z][A-Z0-9_]+)'/g,
        ),
      ].map((match) => match[1] ?? ''),
    );
    const listed = [...text.matchAll(/^\| ([A-Z][A-Z0-9_]+) \|/gm)].map(
      (match) => match[1] ?? '',
    );
    // CONFIG_VERSION_CONFLICT is how a writer says stale; the tools answer
    // it as SETTINGS_STALE.
    raised.delete('CONFIG_VERSION_CONFLICT');
    for (const code of raised) expect(listed, code).toContain(code);
    for (const code of listed) {
      expect(
        sources.includes(`'${code}'`) ||
          ['FORBIDDEN', 'RATE_LIMITED', 'INTERNAL_ERROR'].includes(code),
        code,
      ).toBe(true);
    }
  });

  test('fits what get_docs answers', () => {
    const cap = MCP_TOOLS.find(
      (tool) => tool.name === 'get_docs',
    )?.maxResultChars;
    expect(cap).toBeDefined();
    expect(text.length).toBeLessThan(cap ?? 0);
  });
});
