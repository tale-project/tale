// @vitest-environment node

/**
 * The listings read the newest NON-NULL presentation (automation-identity
 * class): a version saved from the canvas, over MCP or by a manifest-less
 * upload carries none of its own, and reading the latest row alone made the
 * name the wizard stored vanish on the next save (2026-09-26 evaluation,
 * D-03). The SQL is held to the coalescing aggregate on both listings.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listAutomations, listAutomationsForApp } from './store.ts';

/** A tagged-template double that records every query's text and answers
 * nothing — the shape of the SQL is the fact under test. */
function recordingSql(): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    queries.push(strings.join('$?').replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

const COALESCING =
  /array_agg\(a\.presentation ORDER BY [^)]*\) FILTER \(WHERE a\.presentation IS NOT NULL\)/;

describe('the listings coalesce the presentation', () => {
  it('listAutomations takes the newest non-null presentation', async () => {
    const { sql, queries } = recordingSql();
    await listAutomations(sql, 'org-1');
    expect(queries[0]).toMatch(COALESCING);
  });

  it('listAutomationsForApp takes the deployed, else newest, non-null presentation', async () => {
    const { sql, queries } = recordingSql();
    await listAutomationsForApp(sql, 'org-1');
    expect(queries[0]).toMatch(COALESCING);
  });
});
