// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const ENTRYPOINT = fileURLToPath(
  new URL('../../docker-entrypoint.sh', import.meta.url),
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Execute the real entrypoint with a private PATH. The gosu double records
// the handoff instead of changing this test process's OS identity. Nothing
// may dispatch an application before that handoff, even if gosu fails.
function runRootStartup(role: string, gosuExit: number, rmExit = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), 'privilege-drop-guard-'));
  tempDirs.push(dir);
  const log = path.join(dir, 'startup.log');
  writeFileSync(log, '');
  const stubs = {
    id: 'printf "0\\n"',
    iptables: 'printf "firewall:%s\\n" "$*" >> "$STARTUP_LOG"',
    chown: ':',
    rm: 'printf "rm:%s\\n" "$*" >> "$STARTUP_LOG"; exit "$RM_EXIT"',
    gosu: [
      'printf "gosu:%s\\n" "$@" >> "$STARTUP_LOG"',
      'exit "$GOSU_EXIT"',
    ].join('\n'),
    node: 'printf "application:node\\n" >> "$STARTUP_LOG"; exit 97',
    bun: 'printf "application:bun\\n" >> "$STARTUP_LOG"; exit 97',
  };
  for (const [name, source] of Object.entries(stubs)) {
    writeFileSync(path.join(dir, name), `#!/bin/bash\n${source}\n`, {
      mode: 0o755,
    });
  }
  symlinkSync('/bin/date', path.join(dir, 'date'));
  const result = spawnSync('/bin/bash', [ENTRYPOINT, 'argument with spaces'], {
    env: {
      PATH: dir,
      STARTUP_LOG: log,
      GOSU_EXIT: String(gosuExit),
      RM_EXIT: String(rmExit),
      TALE_ROLE: role,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n') };
}

describe('platform root startup', () => {
  it.each(['web', 'api', 'worker', 'all'])(
    'hands %s to the app user after firewall setup, preserving arguments',
    (role) => {
      const result = runRootStartup(role, 0);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.calls[0]).toBe('firewall:-L OUTPUT');
      expect(result.calls).toContain(
        'firewall:-A OUTPUT -d 169.254.169.254/32 -j REJECT --reject-with icmp-net-prohibited',
      );
      expect(result.calls.slice(-3)).toEqual([
        'gosu:app',
        `gosu:${ENTRYPOINT}`,
        'gosu:argument with spaces',
      ]);
      expect(result.calls.some((call) => call.startsWith('application:'))).toBe(
        false,
      );
    },
  );

  it.each(['web', 'api', 'worker', 'all'])(
    'refuses to start %s when the privilege drop fails',
    (role) => {
      const result = runRootStartup(role, 23);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(23);
      expect(result.calls).toContain('gosu:app');
      expect(result.calls.some((call) => call.startsWith('application:'))).toBe(
        false,
      );
    },
  );
});

// A restart keeps /tmp (`docker restart`, an Incus restart). The run markers
// of the previous start are deleted as root, before the drop to `app`: a
// marker an exec created as root in sticky /tmp cannot be deleted by `app`,
// and the api, worker and all roles exec node without reaching the web role's
// own cleanup. A failed delete only warns: the entrypoint runs under
// `set -eo pipefail`, and a start must not die on it.
describe('platform run markers', () => {
  const MARKERS =
    'rm:-f /tmp/platform-withdrawn /tmp/platform-shutting-down /tmp/platform-ready /tmp/backend-withdrawn';

  it.each(['web', 'api', 'worker', 'all'])(
    'deletes every marker as root before %s drops to the app user',
    (role) => {
      const result = runRootStartup(role, 0);
      expect(result.status).toBe(0);
      const deleted = result.calls.indexOf(MARKERS);
      expect(deleted).toBeGreaterThan(-1);
      expect(deleted).toBeLessThan(result.calls.indexOf('gosu:app'));
    },
  );

  it.each(['web', 'api'])(
    'still starts %s when the delete fails, and says so',
    (role) => {
      const result = runRootStartup(role, 0, 1);
      expect(result.status).toBe(0);
      expect(result.calls).toContain(MARKERS);
      expect(result.calls).toContain('gosu:app');
      expect(result.stderr).toContain('could not delete the run markers');
    },
  );
});
