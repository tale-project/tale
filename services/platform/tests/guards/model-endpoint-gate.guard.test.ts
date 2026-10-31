// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A model call that resolves a provider credential is held to the
 * organization's EU/EEA rule before anything is sent (GOV-R17). A module
 * that resolves one either judges the endpoint through the gate in
 * `core/governance/model_endpoint_gate.ts`, or is listed below with the
 * reason it sends no prompt the rule covers yet. A new caller fails here
 * until it does one or the other.
 */

const PLATFORM = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const RESOLVES = /\bresolveProviderCredential\w*\s*\(/;
const GATED =
  /\b(assertModelEndpointAllowed|refuseModelEndpoint|modelEndpointRefusal|gatewayBuiltinRefusal)\b/;

const NOT_GATED: Readonly<Record<string, string>> = {
  'backend/core/provider_credentials/resolve_credential.ts':
    'defines the resolver',
  'backend/domains/provider_credentials/service.ts':
    'adapts the resolver and fetches model listings, which carry no prompt',
  'backend/integration-check.ts':
    'checks a deployment with its own fixtures, not an organization’s prompts',
  'backend/core/node_only/sandbox/gateway_provisioning.ts':
    'provisions the sandbox model gateway (#5186)',
  'backend/core/automations/agent_host.ts':
    'vends a subscription to an automation agent in a sandbox (#5186)',
  'backend/core/tasks/agent_run_host.ts':
    'vends a subscription to a task agent in a sandbox (#5186)',
};

function sources(dir: string): string[] {
  return readdirSync(path.join(PLATFORM, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|integration)\.tsx?$/.test(entry.name),
    )
    .map((entry) =>
      path.relative(PLATFORM, path.join(entry.parentPath, entry.name)),
    )
    .filter((file) => !file.split(path.sep).includes('node_modules'))
    .map((file) => file.split(path.sep).join('/'));
}

const callers = ['backend', 'lib', 'app']
  .flatMap(sources)
  .filter((file) =>
    RESOLVES.test(readFileSync(path.join(PLATFORM, file), 'utf8')),
  );

describe('the EU/EEA gate on provider credentials', () => {
  it('finds the modules that resolve a credential', () => {
    expect(callers.length).toBeGreaterThan(Object.keys(NOT_GATED).length);
  });

  it('holds every caller to the gate, or names why not', () => {
    const ungated = callers.filter(
      (file) =>
        NOT_GATED[file] === undefined &&
        !GATED.test(readFileSync(path.join(PLATFORM, file), 'utf8')),
    );
    expect(ungated).toEqual([]);
  });

  it.each(Object.keys(NOT_GATED))(
    'still needs the exemption for %s',
    (file) => {
      expect(callers).toContain(file);
      expect(GATED.test(readFileSync(path.join(PLATFORM, file), 'utf8'))).toBe(
        false,
      );
    },
  );
});
