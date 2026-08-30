import { expect, test } from 'bun:test';

import { projectCandidates, serviceCandidates } from './targets.ts';

// The controller's allowlist scopes restarts to the backend + sandbox, all
// stateful (never-colored) services, so ROTATABLE is empty: every
// service resolves to a single label under the base project. The blue/green
// candidate machinery stays in place so re-adding a rotatable target (the CLI
// deploys `platform` blue/green — see generate-color-compose in tools/cli)
// needs no code change here, only a ROTATABLE entry.
test('a stateful service stays a single label under the base project', () => {
  expect(serviceCandidates('backend-api')).toEqual(['backend-api']);
  expect(projectCandidates('tale', 'backend-api')).toEqual(['tale']);
});

test('with an empty ROTATABLE set, any service resolves to a single label', () => {
  expect(serviceCandidates('platform')).toEqual(['platform']);
  expect(projectCandidates('tale', 'platform')).toEqual(['tale']);
});

test('unknown project scopes to any (undefined)', () => {
  expect(projectCandidates(undefined, 'backend-api')).toBeUndefined();
});
