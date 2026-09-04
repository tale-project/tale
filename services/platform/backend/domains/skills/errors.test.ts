// @vitest-environment node

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { SKILL_BUNDLE_REFUSAL_CODES } from '../../core/skills/bundle_zip.ts';
import { SKILL_ERROR_STATUS, skillErrorResponse } from './errors.ts';

/**
 * The regression under test: the zip parser is "the authoritative check"
 * for an uploaded bundle, yet three of its refusals (a missing SKILL.md, bad
 * frontmatter, a per-file cap) had no entry in the route's code→status map
 * and reached the client as a blank 500. The map is now built from the
 * parser's own exported list, and every door speaks it.
 */

async function answer(error: unknown): Promise<Response> {
  const app = new Hono();
  app.onError(() => new Response('unmapped', { status: 500 }));
  app.get('/', (c) => skillErrorResponse(c, error));
  return await app.request('/');
}

describe('skill refusal → HTTP status', () => {
  it('maps every refusal the zip parser can throw to a 4xx', () => {
    expect(SKILL_BUNDLE_REFUSAL_CODES.length).toBeGreaterThan(0);
    for (const code of SKILL_BUNDLE_REFUSAL_CODES) {
      const status = SKILL_ERROR_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(500);
    }
  });

  it('answers a SKILL.md-less bundle with 400 and the parser’s own words', async () => {
    const res = await answer(
      new AppError({
        code: 'MISSING_SKILL_MD',
        message: 'Bundle is missing SKILL.md at the root',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'MISSING_SKILL_MD',
      message: 'Bundle is missing SKILL.md at the root',
    });
  });

  it('keeps the file-layer statuses the doors already spoke', async () => {
    const forbidden = await answer(
      new AppError({ code: 'SKILL_FORBIDDEN', message: 'no' }),
    );
    const malformed = await answer(
      new AppError({ code: 'SKILL_MALFORMED', message: 'broken' }),
    );
    expect(forbidden.status).toBe(403);
    expect(malformed.status).toBe(422);
  });

  it('lets an unmapped code and a plain Error reach the app-level handler', async () => {
    expect(
      (await answer(new AppError({ code: 'SOMETHING_NEW', message: 'x' })))
        .status,
    ).toBe(500);
    expect((await answer(new Error('disk on fire'))).status).toBe(500);
  });
});
