// The spawner reaches a session's runnerd at the container's name on the
// sandbox network (`http://<name>:8200`), so every name must be a DNS label a
// resolver accepts. A project agent's workspace for the runs a member starts
// (`pa-<agent id>-m<hash>`) is 57 characters, and with the prefix its name
// once came to 70: it never resolved, and every such run waited out runnerd's
// readiness deadline and failed.

import { describe, expect, test } from 'bun:test';

import { sessionContainerName } from './session-naming.ts';

const AGENT_ID = 'a44ebd71-0391-482f-b02b-7b5001ff9ee3';
const MEMBER_WORKSPACE = `pa-${AGENT_ID}-mc38065a11921cfa7`;

describe('sessionContainerName', () => {
  test('keeps a short session id verbatim', () => {
    expect(sessionContainerName(`pa-${AGENT_ID}`)).toBe(
      `tale-sbx-ses-pa-${AGENT_ID}`,
    );
    expect(sessionContainerName('rnd-0123456789abcdef')).toBe(
      'tale-sbx-ses-rnd-0123456789abcdef',
    );
  });

  test('folds a session id whose name would outgrow a DNS label into a hash', () => {
    const name = sessionContainerName(MEMBER_WORKSPACE);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^tale-sbx-ses-[0-9a-f]{16}$/);
  });

  test('keeps every name a DNS label, up to the 64-character id budget', () => {
    for (let length = 1; length <= 64; length += 1) {
      const name = sessionContainerName('s'.repeat(length));
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i);
    }
  });

  test('names each long session id deterministically and apart', () => {
    const other = `pa-${AGENT_ID}-m0000000000000001`;
    expect(sessionContainerName(MEMBER_WORKSPACE)).toBe(
      sessionContainerName(MEMBER_WORKSPACE),
    );
    expect(sessionContainerName(MEMBER_WORKSPACE)).not.toBe(
      sessionContainerName(other),
    );
  });
});
