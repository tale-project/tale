// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The tale-db image runs every `init-scripts/*.sql` on each container start,
 * for the `db` and the `knowledge-db` role alike — so a database declared
 * there exists on every Postgres the stack runs. The 0.5 platform reads
 * exactly two: `tale_app` (migrated by this backend at boot) and
 * `tale_knowledge` (the corpus, migrated by dbmate in the db entrypoint).
 * The Convex-era `tale_platform` kept being created long after nothing read
 * it; this guard pins the set so a retired store cannot creep back in and a
 * new one cannot appear without the platform learning to use it.
 */

const INIT_SCRIPTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/init-scripts',
);

const CREATE_DATABASE_RE = /CREATE DATABASE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/g;

function initScripts(): { name: string; sql: string }[] {
  return readdirSync(INIT_SCRIPTS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(INIT_SCRIPTS_DIR, name), 'utf8'),
    }));
}

describe('tale-db init scripts', () => {
  it('create exactly the two databases the 0.5 platform reads', () => {
    const created = new Set<string>();
    for (const { sql } of initScripts()) {
      for (const match of sql.matchAll(CREATE_DATABASE_RE)) {
        created.add(match[1] ?? '');
      }
    }
    expect([...created].sort()).toEqual(['tale_app', 'tale_knowledge']);
  });

  it('never mention the retired Convex-era tale_platform database', () => {
    const offenders = initScripts()
      .filter(({ sql }) => sql.includes('tale_platform'))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
