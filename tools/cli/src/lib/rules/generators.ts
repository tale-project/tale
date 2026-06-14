import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  buildClaudeReference,
  buildRulesContent,
  upsertManagedSection,
} from './content';

interface RulesFile {
  relativePath: string;
  content: string;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * The agents-instructions file to manage: an existing `AGENTS.md` / `AGENT.md`
 * if one is already present, else the ecosystem-standard `AGENTS.md`.
 */
function resolveAgentsFile(target: string): string {
  for (const name of ['AGENTS.md', 'AGENT.md']) {
    if (existsSync(join(target, name))) return name;
  }
  return 'AGENTS.md';
}

/**
 * The `CLAUDE.md` to manage: an existing one at the project root or under
 * `.claude/`, else a new root `CLAUDE.md`.
 */
function resolveClaudeFile(target: string): string {
  for (const rel of ['CLAUDE.md', join('.claude', 'CLAUDE.md')]) {
    if (existsSync(join(target, rel))) return rel;
  }
  return 'CLAUDE.md';
}

async function upsertFile(
  target: string,
  relativePath: string,
  body: string,
): Promise<RulesFile> {
  const path = join(target, relativePath);
  const content = upsertManagedSection(await readIfExists(path), body);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { relativePath, content };
}

/**
 * Scaffold (or update) the project's agent instructions. `AGENTS.md` carries
 * the full Tale guidance; `CLAUDE.md` points at it (Claude Code does not read
 * `AGENTS.md` automatically). Both are written through a managed marker block,
 * so any existing user content in those files is preserved across re-runs.
 * Returns the files actually written so the caller can record their checksums.
 */
export async function writeAgentInstructions(
  target: string,
): Promise<RulesFile[]> {
  const agentsFile = resolveAgentsFile(target);
  return [
    await upsertFile(target, agentsFile, buildRulesContent()),
    await upsertFile(
      target,
      resolveClaudeFile(target),
      buildClaudeReference(agentsFile),
    ),
  ];
}
