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

  it('says a field that was not sent "is required", as the REST door does', () => {
    // zod's own text is a type mismatch with `undefined` ("Invalid input:
    // expected string, received undefined").
    expect(describeIssues(parseError({ price: 1 }))).toBe('name: is required');
    // A value of the wrong type keeps zod's reason.
    expect(describeIssues(parseError({ name: 1, price: 1 }))).toMatch(
      /^name: Invalid input: expected string, received number$/,
    );
  });

  it("keeps a schema's own sentence for an absent field", () => {
    const own = z.object({ model: z.string({ error: 'pick a model' }) });
    const outcome = own.safeParse({});
    if (outcome.success) throw new Error('expected a failed parse');
    expect(describeIssues(outcome.error)).toBe('model: pick a model');
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

  // Regression: zod reports every unknown key of a strict object as ONE
  // issue whose message lists them all, so the cap of twenty issues did not
  // bound the echo — a body of thousands of unknown keys came back whole.
  it('names each unknown key on its own, within the same bound', async () => {
    const strict = z.object({ name: z.string() }).strict();
    const hostile = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [`k${i}`, 1]),
    );
    const outcome = strict.safeParse({ name: 'Kettle', ...hostile });
    if (outcome.success) throw new Error('expected a failed parse');
    const app = new Hono().post('/', (c) =>
      invalidBodyResponse(c, outcome.error),
    );
    const body = (await (
      await app.request('/', { method: 'POST' })
    ).json()) as Refusal;
    expect(body.data.issues).toHaveLength(20);
    expect(body.data.issues[0]).toEqual({
      path: 'k0',
      message: 'is not a field this body takes',
    });
    expect(body.message).not.toContain('k20');
    expect(body.message.length).toBeLessThan(1000);
  });

  it('names an unknown key of a nested object by its dotted path', () => {
    const nested = z.object({ config: z.object({ a: z.string() }).strict() });
    const outcome = nested.safeParse({ config: { a: 'x', b: 1 } });
    if (outcome.success) throw new Error('expected a failed parse');
    expect(describeIssues(outcome.error)).toBe(
      'config.b: is not a field this body takes',
    );
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
 * module, the one place the code is written: any other `'invalid body'`
 * literal — a bare refusal, a constant a bare refusal could be written
 * through, a second helper — is the regression this guard names. A
 * comparison (`=== 'invalid body'`) only reads the code, and passes.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const HELPER = path.join(HERE, 'invalid-body-response.ts');
const BARE_REFUSAL = /(?<![=!]==\s*)(['"`])invalid body\1/;

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

/** A comment may name the code (the history of a fix); only code writes it. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

function isBareRefusal(line: string): boolean {
  return !COMMENT_LINE.test(line) && BARE_REFUSAL.test(line);
}

function bareRefusals(): string[] {
  return sourceFiles(BACKEND).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        isBareRefusal(line)
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
      `write the code only through invalidBodyResponse / invalidBodyIssuesResponse (backend/lib/invalid-body-response.ts): ${bare.join(', ')}`,
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

  it.each([
    ["return c.json({ error: 'invalid body' }, 400);", true],
    ["const INVALID_BODY = 'invalid body';", true],
    ["if (body.error === 'invalid body') return;", false],
    ["if (body.error !== 'invalid body') return;", false],
    // The formatter keeps a double-quoted or template literal as written.
    ['return c.json({ error: "invalid body" }, 400);', true],
    ['const code = `invalid body`;', true],
    // A comment recounting a fix writes no refusal.
    ["  // it used to answer a bare 'invalid body'", false],
    ['   * answered a bare `invalid body` that named no field', false],
  ])('the scan judges %s', (line, flagged) => {
    expect(isBareRefusal(line)).toBe(flagged);
  });
});
