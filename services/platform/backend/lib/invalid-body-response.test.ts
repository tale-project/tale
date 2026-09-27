import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  describeIssues,
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

describe('invalidBodyResponse', () => {
  it('names each failed field in the message and lists the issues', async () => {
    const app = new Hono().post('/', (c) =>
      invalidBodyResponse(c, parseError({ price: 1e20 })),
    );
    const response = await app.request('/', { method: 'POST' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      message: string;
      data: { issues: { path: string; message: string }[] };
    };
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
