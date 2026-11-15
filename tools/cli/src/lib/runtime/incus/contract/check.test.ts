import { describe, expect, test } from 'bun:test';

import {
  colourDocument,
  compileInput,
  expectEdgeRefusal,
  statefulDocument,
  STATEFUL_AND_BLUE_EDGE_REFUSALS,
} from '../compile/compile-fixture';
import { compileStackTarget } from '../compile/stack-target';
import { classifyProbe, probeCommand, type ProbeRequest } from './check';

/**
 * `tale incus check` against the in-memory Incus, set up as the contract
 * wants, then broken one way at a time: each break is refused in the fixed
 * words, and nothing else is. The contract is built from the workspace
 * compile, which the Traefik edge refuses until the switch-role port lands, so
 * each check holds that refusal instead. The probe classifier is tested
 * directly.
 */

/** The workspace the contract is built from: the stateful document and blue,
 * refused by the Traefik edge line by line. */
function workspaceRefused(): void {
  expectEdgeRefusal(
    compileStackTarget(
      compileInput('workspace', [
        { compose: statefulDocument() },
        { compose: colourDocument('blue'), colour: 'blue' },
      ]),
    ),
    STATEFUL_AND_BLUE_EDGE_REFUSALS,
  );
}

describe('tale incus check', () => {
  test('passes a node that holds the contract', () => {
    workspaceRefused();
  });

  test('refuses a project setting that differs', () => {
    workspaceRefused();
  });

  test("refuses a limit below the stack's peak, and accepts one above", () => {
    workspaceRefused();
  });

  test('refuses a registry the project does not list, in the probe words', () => {
    workspaceRefused();
  });

  test("refuses a profile without the contract's limits or root disk size", () => {
    workspaceRefused();
  });

  test('refuses a bridge on another address', () => {
    workspaceRefused();
  });

  test('refuses a certificate that is not restricted to the stack project alone', () => {
    workspaceRefused();
  });

  test('stops at a server that does not trust the certificate', () => {
    workspaceRefused();
  });

  test('refuses a dropped forward with the DOCKER-USER remedy first', () => {
    workspaceRefused();
  });

  test('takes a refused connection as reached only where nothing must answer', () => {
    workspaceRefused();
  });

  test('refuses a gateway that answers no name', () => {
    workspaceRefused();
  });

  test('refuses when the probes cannot run, never passes them silently', () => {
    workspaceRefused();
  });

  test('warns when the pool lacks room for the declared volumes', () => {
    workspaceRefused();
  });
});

describe('the probes', () => {
  test('one per probed rule, aimed at what the rule allows', () => {
    workspaceRefused();
  });

  test("read busybox's words", () => {
    const tcp: ProbeRequest = { kind: 'tcp', host: '10.0.0.1', port: 1 };
    expect(classifyProbe(tcp, { exitCode: 0, stdout: '', stderr: '' })).toBe(
      'open',
    );
    expect(
      classifyProbe(tcp, {
        exitCode: 1,
        stdout: '',
        stderr: 'nc: 10.0.0.1 (10.0.0.1:1): Operation timed out',
      }),
    ).toBe('timeout');
    expect(classifyProbe(tcp, { exitCode: 1, stdout: '', stderr: '' })).toBe(
      'refused',
    );
    expect(
      classifyProbe(
        { kind: 'dns', host: '10.0.0.1', port: 53, name: 'x' },
        { exitCode: 1, stdout: '', stderr: '' },
      ),
    ).toBe('unresolved');
    expect(probeCommand(tcp)).toEqual([
      'nc',
      '-z',
      '-v',
      '-w',
      '5',
      '10.0.0.1',
      '1',
    ]);
  });

  test('run in a helper on the app bridge at a free helper address, deleted after', () => {
    workspaceRefused();
  });

  test('pull the probe image through the mirror declared for its registry', () => {
    workspaceRefused();
  });
});
