#!/usr/bin/env tsx
/**
 * Dev-time script: restructure example agent JSON files to the i18n-first
 * shape. Moves any top-level translatable field (`displayName`, `description`,
 * `conversationStarters`, `systemInstructions`) into `i18n.en.<field>` so the
 * canonical source lives under `i18n`. Existing `i18n.<locale>.*` entries
 * (e.g. hand-authored German / French) are preserved.
 *
 * Does NOT call the LLM translator — de/fr gaps remain for the author (or a
 * follow-up script) to fill via the shipped auto-translate UI.
 *
 * Usage: tsx services/platform/scripts/backfill_example_i18n.ts
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRANSLATABLE_FIELDS = [
  'displayName',
  'description',
  'conversationStarters',
  'systemInstructions',
] as const;

interface AgentFile {
  [key: string]: unknown;
  i18n?: Record<string, Record<string, unknown>>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolvePath(__dirname, '../../../examples/agents');

function restructure(agent: AgentFile): {
  changed: boolean;
  next: AgentFile;
} {
  const i18n = { ...agent.i18n };
  const en = { ...i18n.en };
  let changed = false;

  for (const field of TRANSLATABLE_FIELDS) {
    const topLevel = agent[field];
    if (topLevel === undefined || topLevel === null) continue;
    // Preserve any existing i18n.en.<field> — don't clobber hand-authored text.
    if (en[field] === undefined) {
      en[field] = topLevel;
    }
    // Retire the top-level field.
    delete agent[field];
    changed = true;
  }

  if (Object.keys(en).length > 0) {
    i18n.en = en;
  }
  if (Object.keys(i18n).length > 0) {
    agent.i18n = i18n;
  }

  return { changed, next: agent };
}

function reorderKeys(agent: AgentFile): AgentFile {
  // Put i18n at the bottom for readability — it's the biggest block.
  const { i18n, ...rest } = agent;
  return i18n ? { ...rest, i18n } : rest;
}

function main(): void {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'));
  console.log(`Found ${files.length} agent files in ${EXAMPLES_DIR}`);

  let updatedCount = 0;
  for (const file of files) {
    const path = join(EXAMPLES_DIR, file);
    const raw = readFileSync(path, 'utf-8');
    const agent = JSON.parse(raw) as AgentFile;
    const { changed, next } = restructure(agent);

    if (!changed) {
      console.log(`  ${file}: already i18n-first, skipping`);
      continue;
    }

    const ordered = reorderKeys(next);
    writeFileSync(path, JSON.stringify(ordered, null, 2) + '\n', 'utf-8');
    updatedCount++;
    const locales = Object.keys(next.i18n ?? {}).join(', ') || '(none)';
    console.log(`  ${file}: restructured, locales=[${locales}]`);
  }

  console.log(`\nDone. Updated ${updatedCount} file(s).`);
}

main();
