// Create-conflict reconcile predicates. The safety-critical invariant is that
// only a TERMINAL (exited/dead) container is ever reaped on a name conflict —
// reaping a running/created/paused container would kill a concurrent winner's
// healthy session on another spawner replica. These pin that so a refactor
// can't loosen it to "anything that isn't running".

import { describe, expect, test } from 'bun:test';

import {
  isDockerNameConflict,
  isReapableContainerStatus,
} from './docker-session-backend.ts';

describe('isDockerNameConflict', () => {
  test('matches the daemon name-collision message (the observed failure)', () => {
    const stderr =
      'docker: Error response from daemon: Conflict. The container name ' +
      '"/tale-sbx-ses-usr-abc" is already in use by container "f751…". You ' +
      'have to remove (or rename) that container to be able to reuse that name.';
    expect(isDockerNameConflict(stderr)).toBe(true);
  });

  test('matches "already in use" and "Conflict" case-insensitively', () => {
    expect(isDockerNameConflict('name is already in use')).toBe(true);
    expect(isDockerNameConflict('CONFLICT: nope')).toBe(true);
  });

  test('does not match unrelated docker errors', () => {
    expect(isDockerNameConflict('no such image: tale-sandbox:test')).toBe(
      false,
    );
    expect(isDockerNameConflict('Cannot connect to the Docker daemon')).toBe(
      false,
    );
    expect(isDockerNameConflict('')).toBe(false);
  });
});

describe('isReapableContainerStatus', () => {
  test('only terminal states (exited/dead) are reapable', () => {
    expect(isReapableContainerStatus('exited')).toBe(true);
    expect(isReapableContainerStatus('dead')).toBe(true);
    // tolerate the trailing newline docker inspect emits
    expect(isReapableContainerStatus('exited\n')).toBe(true);
  });

  test('a possibly-live peer is NEVER reapable', () => {
    for (const status of [
      'running',
      'created',
      'restarting',
      'paused',
      'removing',
    ]) {
      expect(isReapableContainerStatus(status)).toBe(false);
    }
  });

  test('an unknown/garbage status is not reapable', () => {
    expect(isReapableContainerStatus('')).toBe(false);
    expect(isReapableContainerStatus('wat')).toBe(false);
  });
});
