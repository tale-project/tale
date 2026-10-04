import { expect, test } from 'bun:test';

import { dependencyHealth } from './dependency-health.ts';

test('dependency diagnostics reuse Docker readiness and omit unrequested capabilities', async () => {
  const previous = process.env.TALE_TRANSPARENT_EGRESS;
  delete process.env.TALE_TRANSPARENT_EGRESS;
  try {
    expect(await dependencyHealth()).toBeUndefined();
    expect(await dependencyHealth(false)).toEqual({ docker: { ok: false } });
    expect(await dependencyHealth(true)).toEqual({ docker: { ok: true } });
  } finally {
    if (previous === undefined) delete process.env.TALE_TRANSPARENT_EGRESS;
    else process.env.TALE_TRANSPARENT_EGRESS = previous;
  }
});
