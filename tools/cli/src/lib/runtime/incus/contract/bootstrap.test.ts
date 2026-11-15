import { describe, test } from 'bun:test';

import {
  colourDocument,
  compileInput,
  expectEdgeRefusal,
  statefulDocument,
  STATEFUL_AND_BLUE_EDGE_REFUSALS,
} from '../compile/compile-fixture';
import { compileStackTarget } from '../compile/stack-target';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

/**
 * `tale incus bootstrap` against an in-memory administrator socket. Its plan
 * and removal take the node contract, which is built from the workspace
 * compile; the Traefik edge refuses that compile until the switch-role port
 * lands. Each test holds the refusal instead, and the socket harness that
 * drove the plans is in the history of this file.
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

describePosix('tale incus bootstrap', () => {
  test('plans every object on a fresh host, then makes them', () => {
    workspaceRefused();
  });

  test("writes a managed deployment's credentials into its state directory and no tale.json", () => {
    workspaceRefused();
  });

  test('keeps a Docker workspace on Docker, writing its migration target', () => {
    workspaceRefused();
  });

  test('changes nothing on a second run', () => {
    workspaceRefused();
  });

  test('corrects what it made, and refuses to change what it did not', () => {
    workspaceRefused();
  });

  test('never renumbers a bridge, and uses the host pool it finds', () => {
    workspaceRefused();
  });

  test('makes the sandbox zone an operator makes from the spawner docs', () => {
    workspaceRefused();
  });

  test('refuses a server certificate it cannot pin, and replaces it only when asked', () => {
    workspaceRefused();
  });

  test("asks for DOCKER-USER rules only where Docker's FORWARD policy drops", () => {
    workspaceRefused();
  });

  test("warns when another project stops inside Tale's band", () => {
    workspaceRefused();
  });
});

describe('tale incus bootstrap --remove', () => {
  test('removes what bootstrap made, in reverse, and the credentials', () => {
    workspaceRefused();
  });

  test('refuses while a project still holds instances', () => {
    workspaceRefused();
  });

  test('keeps credentials a workspace already had', () => {
    workspaceRefused();
  });

  test("keeps an operator's own credentials and trust entry", () => {
    workspaceRefused();
  });
});
