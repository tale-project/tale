import { describe, expect, it } from 'vitest';

import { ApiError } from '@/app/lib/api/client';

import {
  existingIdOfRefusal,
  parseCauseOfRefusal,
  sessionOfRefusal,
} from './refusals';

const refusal = (code: string, extra: Record<string, unknown> = {}) =>
  new ApiError(409, code, 'x', extra);

describe('sessionOfRefusal', () => {
  it('reads the session a refusal names', () => {
    const session = { id: 4, name: 'work', status: 'stopped' };
    expect(sessionOfRefusal(refusal('proxy_in_use', { session }))).toEqual(
      session,
    );
  });

  it('knows nothing of a refusal that names none, or names it wrongly', () => {
    expect(sessionOfRefusal(refusal('proxy_in_use'))).toBeNull();
    expect(
      sessionOfRefusal(refusal('proxy_in_use', { session: { id: 'x' } })),
    ).toBeNull();
  });
});

describe('existingIdOfRefusal', () => {
  it('reads the id of the proxy a duplicate repeats', () => {
    expect(existingIdOfRefusal(refusal('duplicate', { existingId: 7 }))).toBe(
      7,
    );
  });

  it('knows nothing without a valid id', () => {
    expect(existingIdOfRefusal(refusal('duplicate'))).toBeNull();
    expect(
      existingIdOfRefusal(refusal('duplicate', { existingId: 'seven' })),
    ).toBeNull();
    expect(existingIdOfRefusal(refusal('duplicate', { existingId: 0 }))).toBe(
      null,
    );
  });
});

describe('parseCauseOfRefusal', () => {
  it('reads the code and the parameters of the reason', () => {
    expect(
      parseCauseOfRefusal(
        refusal('invalid_proxy', {
          reason: 'invalid_port_value',
          params: { port: '99999' },
        }),
      ),
    ).toEqual({ code: 'invalid_port_value', params: { port: '99999' } });
  });

  it('reads a reason without parameters, or with unusable ones', () => {
    expect(
      parseCauseOfRefusal(refusal('invalid_proxy', { reason: 'missing_port' })),
    ).toEqual({ code: 'missing_port', params: {} });
    expect(
      parseCauseOfRefusal(
        refusal('invalid_proxy', { reason: 'missing_port', params: [1, 2] }),
      ),
    ).toEqual({ code: 'missing_port', params: {} });
  });

  it('knows no reason when the refusal carries no reason', () => {
    expect(parseCauseOfRefusal(refusal('invalid_proxy'))).toBeNull();
    expect(
      parseCauseOfRefusal(refusal('invalid_proxy', { reason: '' })),
    ).toBeNull();
    expect(
      parseCauseOfRefusal(refusal('invalid_proxy', { reason: 3 })),
    ).toBeNull();
  });
});
