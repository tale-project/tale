// @vitest-environment node

import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import { API_CONTRACT_VERSION } from '../shared/constants/api-contract';
import {
  buildTaleSkill,
  SKILL_DESCRIPTION,
  SKILL_SECTIONS,
  TALE_SKILL_NAME,
} from './skill';
import {
  isServedAddress,
  mentionedAddresses,
  toolLikeWords,
} from './test-helpers';
import { MCP_TOOLS } from './tools';

/**
 * The Tale skill holds to the Agent Skills format
 * (https://agentskills.io/specification) and to what this server serves.
 * The snapshot shows a reviewer every change of wording; regenerate it with
 * `UPDATE_TALE_SKILL_SNAPSHOT=1 bunx vitest run --project server
 * lib/mcp/skill.test.ts` and read what moved.
 */

const SNAPSHOT = new URL('./skill.snapshot.md', import.meta.url);
const INVENTORY = new Set(MCP_TOOLS.map((tool) => tool.name));

const frontmatterSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  license: z.string(),
  compatibility: z.string(),
  metadata: z.record(z.string(), z.string()),
});

function split(skill: string): { frontmatter: unknown; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill);
  if (match === null) throw new Error('SKILL.md opens with a frontmatter');
  return { frontmatter: parse(match[1] ?? ''), body: match[2] ?? '' };
}

describe('the Tale skill', () => {
  const skill = buildTaleSkill();
  const { frontmatter, body } = split(skill);
  const meta = frontmatterSchema.parse(frontmatter);

  test('carries the frontmatter the format requires, within its limits', () => {
    expect(meta.name).toBe(TALE_SKILL_NAME);
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta.name.length).toBeLessThanOrEqual(64);
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
    expect(meta.compatibility.length).toBeLessThanOrEqual(500);
    expect(meta.metadata.contract).toBe(API_CONTRACT_VERSION);
  });

  test("names the repository's own license", () => {
    const license = readFileSync(
      new URL('../../../../LICENSE', import.meta.url),
      'utf8',
    );
    expect(license.startsWith(`${meta.license} License`)).toBe(true);
  });

  test('keeps its body short enough to load whole', () => {
    expect(body.split('\n').length).toBeLessThanOrEqual(300);
    expect(body.length).toBeLessThanOrEqual(16_000);
  });

  test('every line declares exactly the tools it names, and names only tools the inventory holds', () => {
    for (const line of [
      ...SKILL_DESCRIPTION,
      ...SKILL_SECTIONS.flatMap((section) => section.lines),
    ]) {
      expect(toolLikeWords(line.text), line.text).toEqual(
        [...line.tools].sort(),
      );
    }
    expect(toolLikeWords(skill).filter((word) => !INVENTORY.has(word))).toEqual(
      [],
    );
  });

  test('names only addresses the server reads', () => {
    expect(
      mentionedAddresses(skill).filter((uri) => !isServedAddress(uri)),
    ).toEqual([]);
  });

  test('teaches only refusal codes the server answers', () => {
    const codes = [...body.matchAll(/^\| ([A-Z][A-Z0-9_]+) \|/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(codes.length).toBeGreaterThan(0);
    const sources = [
      '../engine/api/dispatch.ts',
      '../../backend/domains/mcp/tools.ts',
      '../../backend/domains/automations/store.ts',
    ]
      .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
      .join('\n');
    for (const code of codes) {
      expect(sources, code).toContain(`'${code}'`);
    }
  });

  test('is one file for every deployment, naming no address, key or organization [MCP-R25]', () => {
    expect(buildTaleSkill()).toBe(skill);
    // The one address is the placeholder a person reads as theirs.
    expect(
      [...skill.matchAll(/https?:\/\/[^\s)"]+/g)].map((match) => match[0]),
    ).toEqual(['https://<your']);
    expect(skill).not.toMatch(/tale_[A-Za-z0-9]{8,}/);
    expect(skill).not.toMatch(/Bearer\s/);
    expect(skill).not.toMatch(/X-Organization-Slug/i);
  });

  test('leaves out a line whose tool the inventory lacks, and a section left empty', () => {
    const without = new Set(
      [...INVENTORY].filter((tool) => tool !== 'start_run'),
    );
    const trimmed = buildTaleSkill(without);
    expect(trimmed).not.toContain('start_run');
    expect(trimmed).toContain('## Testing');
    const onlyLater = buildTaleSkill(INVENTORY, [
      ...SKILL_SECTIONS,
      {
        heading: 'Later',
        lines: [{ text: 'Call a_later_tool.', tools: ['a_later_tool'] }],
      },
    ]);
    expect(onlyLater).not.toContain('## Later');
  });

  test('matches the reviewed snapshot', () => {
    if (process.env.UPDATE_TALE_SKILL_SNAPSHOT === '1') {
      writeFileSync(SNAPSHOT, skill);
    }
    expect(skill).toBe(readFileSync(SNAPSHOT, 'utf8'));
  });
});
