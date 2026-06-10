// Unit tests for the shared exec helpers: the exit-code classification matrix
// (including the authoritative OOM hint), UTF-8-safe text capping, and
// harvestOutputDir's resilience (non-regular files, EP1 short-circuit) — all
// review findings pinned without a daemon or cluster.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { capText, classifyFailure, harvestOutputDir } from './exec-common.ts';

describe('classifyFailure', () => {
  test('124 ⇒ TIMEOUT regardless of stderr', () => {
    expect(classifyFailure(124, 'anything').code).toBe('TIMEOUT');
  });

  test('137 matrix: hint beats the stderr heuristic', () => {
    // No signal at all ⇒ assume our own SIGKILL (timeout).
    expect(classifyFailure(137, '').code).toBe('TIMEOUT');
    // Substring heuristic (docker: the shell's "Killed" message).
    expect(classifyFailure(137, 'bash: line 1: Killed').code).toBe('OOM');
    // Authoritative hint (k8s terminated.reason === 'OOMKilled') — fires even
    // though the k8s stderr file never contains "Killed" (it goes to the pod
    // log, not STDERR_PATH).
    expect(classifyFailure(137, '', { oomKilled: true }).code).toBe('OOM');
    expect(classifyFailure(137, '', { oomKilled: false }).code).toBe('TIMEOUT');
  });

  test('64 install-phase exits classify by stderr content', () => {
    expect(classifyFailure(64, 'No matching distribution found').code).toBe(
      'PACKAGE_NOT_FOUND',
    );
    expect(classifyFailure(64, '403 Filtered by proxy').code).toBe(
      'EGRESS_DENIED',
    );
    expect(classifyFailure(64, 'something else').code).toBe('INSTALL_FAILED');
  });

  test('65 ⇒ SPAWNER_UNAVAILABLE; default ⇒ RUNTIME_ERROR; EGRESS regex on any exit', () => {
    expect(classifyFailure(65, '').code).toBe('SPAWNER_UNAVAILABLE');
    expect(classifyFailure(3, '').code).toBe('RUNTIME_ERROR');
    expect(classifyFailure(1, 'Tunnel connection failed: 403').code).toBe(
      'EGRESS_DENIED',
    );
  });
});

describe('capText', () => {
  test('within the cap is returned verbatim', () => {
    expect(capText('hello', 100)).toEqual({ text: 'hello', truncated: false });
  });

  test('a cut landing mid-codepoint leaves no U+FFFD garbage at the tail', () => {
    // '€' is 3 bytes; a 4-byte cap cuts the second one mid-sequence.
    const { text, truncated } = capText('€€', 4);
    expect(truncated).toBe(true);
    expect(text).toBe('€');
    expect(text.includes('�')).toBe(false);
  });
});

describe('harvestOutputDir resilience', () => {
  let dir: string;
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Connection-refused endpoint: every EP1 slot request fails fast.
  const deadEndpoints = {
    outputUrlEndpoint: 'http://127.0.0.1:1/ep1',
    reportUploadedEndpoint: 'http://127.0.0.1:1/ep2',
  };
  const caps = { perFileMax: 1024 * 1024, totalMax: 10 * 1024 * 1024 };

  test('skips dangling symlinks without failure entries or a throw', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tale-harvest-'));
    await mkdir(join(dir, 'output'), { recursive: true });
    await symlink('/nonexistent-target', join(dir, 'output', 'dangling'));
    const result = await harvestOutputDir(
      dir,
      caps,
      [],
      deadEndpoints,
      'exec-1',
      null,
    );
    // A benign skip must NOT pollute failures[] — the platform treats any
    // entry as fatal UPLOAD_INCOMPLETE.
    expect(result.uploadStats.failures).toEqual([]);
    expect(result.readFailed).toBe(false);
    expect(result.files).toEqual([]);
  });

  test('EP1 hard failure short-circuits: one slot request for many files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tale-harvest-'));
    await mkdir(join(dir, 'output'), { recursive: true });
    await writeFile(join(dir, 'output', 'a.txt'), 'aaa');
    await writeFile(join(dir, 'output', 'b.txt'), 'bbb');
    await writeFile(join(dir, 'output', 'c.txt'), 'ccc');
    const result = await harvestOutputDir(
      dir,
      caps,
      [],
      deadEndpoints,
      'exec-1',
      null,
    );
    expect(result.uploadFailed).toBe(true);
    const slotRequestFailures = result.uploadStats.failures.filter(
      (f) => f.fileName === '(slot-request)',
    );
    expect(slotRequestFailures).toHaveLength(1);
    // Every file still gets its own no-slot failure entry.
    const perFile = result.uploadStats.failures.filter(
      (f) => f.fileName !== '(slot-request)',
    );
    expect(perFile).toHaveLength(3);
  });
});
