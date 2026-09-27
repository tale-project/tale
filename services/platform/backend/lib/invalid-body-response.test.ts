import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  describeIssues,
  invalidBodyIssuesResponse,
  invalidBodyResponse,
} from './invalid-body-response.ts';

const schema = z.object({
  name: z.string().min(1),
  price: z.number().max(1000),
});

function parseError(input: unknown): z.ZodError {
  const outcome = schema.safeParse(input);
  if (outcome.success) throw new Error('expected a failed parse');
  return outcome.error;
}

interface Refusal {
  error: string;
  message: string;
  data: { issues: { path: string; message: string }[] };
}

describe('invalidBodyResponse', () => {
  it('names each failed field in the message and lists the issues', async () => {
    const app = new Hono().post('/', (c) =>
      invalidBodyResponse(c, parseError({ price: 1e20 })),
    );
    const response = await app.request('/', { method: 'POST' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Refusal;
    expect(body.error).toBe('invalid body');
    expect(body.message).toMatch(/^name: .*; price: .*/);
    expect(body.data.issues.map((issue) => issue.path)).toEqual([
      'name',
      'price',
    ]);
  });

  it('calls the root "body" when the whole value is wrong', () => {
    expect(describeIssues(parseError(null))).toMatch(/^body: /);
  });
});

describe('invalidBodyIssuesResponse', () => {
  it('lists at most twenty issues, as the REST door does', async () => {
    const wide = z.object(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`f${i}`, z.string()]),
      ),
    );
    const outcome = wide.safeParse({});
    if (outcome.success) throw new Error('expected a failed parse');
    const app = new Hono().post('/', (c) =>
      invalidBodyResponse(c, outcome.error),
    );
    const body = (await (
      await app.request('/', { method: 'POST' })
    ).json()) as Refusal;
    expect(body.data.issues).toHaveLength(20);
    expect(body.message.split('; ')).toHaveLength(20);
  });

  it('answers a refusal no schema raised in the same shape', async () => {
    const app = new Hono().post('/', (c) =>
      invalidBodyIssuesResponse(c, [{ path: 'body', message: 'must be JSON' }]),
    );
    const response = await app.request('/', { method: 'POST' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid body',
      message: 'body: must be JSON',
      data: { issues: [{ path: 'body', message: 'must be JSON' }] },
    });
  });
});

/**
 * About 190 app doors used to answer a refused body with a bare
 * `{ error: 'invalid body' }`: the dialog showed "invalid body", and the
 * error report carried the same opaque code, so nobody could tell which
 * field the form had let through. Every door now answers through this
 * module; a new bare literal is the regression this guard names.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const HELPER = path.join(HERE, 'invalid-body-response.ts');
const BARE_REFUSAL = /\berror:\s*'invalid body'/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...sourceFiles(full));
    } else if (full.endsWith('.ts') && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function bareRefusals(): string[] {
  return sourceFiles(BACKEND).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        BARE_REFUSAL.test(line)
          ? [`${path.relative(BACKEND, file)}:${index + 1}`]
          : [],
      ),
  );
}

describe('the app doors', () => {
  it('answer a refused body through the shared helper, never a bare code', () => {
    const helper = path.relative(BACKEND, HELPER);
    const bare = bareRefusals().filter((site) => !site.startsWith(helper));
    expect(
      bare,
      `answer these with invalidBodyResponse / invalidBodyIssuesResponse (backend/lib/invalid-body-response.ts): ${bare.join(', ')}`,
    ).toEqual([]);
  });

  it('the scan sees the literal where it does occur', () => {
    // The guard above would pass vacuously if the pattern matched nothing;
    // the helper itself writes the code.
    const helper = path.relative(BACKEND, HELPER);
    expect(bareRefusals().some((site) => site.startsWith(`${helper}:`))).toBe(
      true,
    );
  });
});
