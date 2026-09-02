// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The platform image ships from a `FROM scratch` squash stage that flattens
 * the runner's layers — and `FROM scratch` drops every upstream ENV
 * directive, so the squash re-declares them by hand. A var added to the
 * runner block but not the squash block is therefore silently absent from
 * every deployed container: KNOWLEDGE_MIGRATIONS_DIR was dropped exactly
 * this way, so `findMigrationsDir` (whose repo-walk fallback finds nothing
 * in a flat image) returned null and the BYO-corpus flow degraded to "apply
 * the migrations yourself" — the very production bug MIGRATION.md records as
 * fixed. This guard pins the two ENV blocks equal, name AND value, and pins
 * the migrations tree copy + pointer pair itself.
 */

const DOCKERFILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../Dockerfile',
);

/**
 * The env assignments of every ENV instruction in one build stage. Docker
 * strips full-line comments before joining `\` continuations, so a comment
 * line inside a continued ENV block neither ends the instruction nor
 * carries an assignment — this parser does the same.
 */
function envOfStage(stage: string): Map<string, string> {
  const vars = new Map<string, string>();
  let inEnv = false;
  for (const line of stage.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const opensEnv = /^ENV\s/.test(line);
    if (!inEnv && !opensEnv) continue;
    const continues = /\\\s*$/.test(line);
    const body = line
      .replace(/^ENV\s+/, '')
      .replace(/\\\s*$/, '')
      .trim();
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(body);
    if (match) {
      vars.set(match[1] ?? '', match[2] ?? '');
    }
    inEnv = continues;
  }
  return vars;
}

function stages(): { runner: string; squash: string } {
  const source = readFileSync(DOCKERFILE, 'utf8');
  const parts = source.split(/^(?=FROM\s)/m);
  const runner = parts.find((part) => /^FROM\s.*\sAS runner\b/.test(part));
  const squash = parts.find((part) => /^FROM scratch\b/.test(part));
  if (!runner || !squash) {
    throw new Error(
      'runner/squash stages not found in services/platform/Dockerfile — update this guard alongside the Dockerfile',
    );
  }
  return { runner, squash };
}

describe('Dockerfile squash-stage ENV parity', () => {
  it('re-declares every runner ENV var, name and value', () => {
    const { runner, squash } = stages();
    const runnerEnv = envOfStage(runner);
    const squashEnv = envOfStage(squash);
    // Sanity: the parser actually saw the blocks.
    expect(runnerEnv.size).toBeGreaterThanOrEqual(10);
    // Set equality with per-var messages: a drift names the variable.
    for (const [name, value] of runnerEnv) {
      expect(squashEnv.get(name), `squash ENV drops or changes ${name}`).toBe(
        value,
      );
    }
    for (const name of squashEnv.keys()) {
      expect(runnerEnv.has(name), `squash-only ENV var ${name}`).toBe(true);
    }
  });

  it('ships the knowledge-corpus DDL with its ENV pointer', () => {
    const { runner, squash } = stages();
    // The tree is copied into the runner (the squash inherits the filesystem
    // whole via `COPY --from=runner / /`)…
    expect(runner).toMatch(
      /COPY[^\n]*services\/db\/migrations\/knowledge-db[^\n]*\.\/db\/migrations\/knowledge-db/,
    );
    // …and BOTH stages point KNOWLEDGE_MIGRATIONS_DIR at it, because the
    // fallback walk finds no repo checkout inside a container.
    expect(envOfStage(runner).get('KNOWLEDGE_MIGRATIONS_DIR')).toBe(
      '/app/db/migrations/knowledge-db',
    );
    expect(envOfStage(squash).get('KNOWLEDGE_MIGRATIONS_DIR')).toBe(
      '/app/db/migrations/knowledge-db',
    );
  });
});
