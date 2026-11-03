import { describe, expect, it } from 'vitest';

import { readSharedIpConflict } from './shared-ip';

describe('readSharedIpConflict', () => {
  it('reads the exit IP and the names of the sessions that use it', () => {
    expect(
      readSharedIpConflict({
        exitIp: '203.0.113.7',
        sessions: [
          { id: 1, name: 'Shop', status: 'running' },
          { id: 2, name: 'Bank', status: 'running' },
        ],
      }),
    ).toEqual({ exitIp: '203.0.113.7', names: ['Shop', 'Bank'] });
  });

  it('leaves out what the backend did not say', () => {
    expect(readSharedIpConflict({})).toEqual({ exitIp: null, names: [] });
    expect(readSharedIpConflict({ exitIp: null, sessions: null })).toEqual({
      exitIp: null,
      names: [],
    });
  });

  it('trusts nothing of a body that is not what it should be', () => {
    expect(readSharedIpConflict({ exitIp: 7, sessions: 'Shop' })).toEqual({
      exitIp: null,
      names: [],
    });
    expect(
      readSharedIpConflict({ exitIp: '203.0.113.7', sessions: [{ id: 1 }] }),
    ).toEqual({ exitIp: null, names: [] });
  });
});
