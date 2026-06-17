import { expect, test } from 'bun:test';

import { projectCandidates, serviceCandidates } from './targets.ts';

// The controller's allowlist currently scopes restarts to `convex` only, and
// `convex` is a stateful (never-colored) service, so ROTATABLE is empty: every
// service resolves to a single label under the base project. The blue/green
// candidate machinery stays in place so re-adding a rotatable target (the CLI
// deploys `platform` blue/green — see generate-color-compose in tools/cli)
// needs no code change here, only a ROTATABLE entry.
test('stateful convex stays a single label under the base project', () => {
  expect(serviceCandidates('convex')).toEqual(['convex']);
  expect(projectCandidates('tale', 'convex')).toEqual(['tale']);
});

test('with an empty ROTATABLE set, any service resolves to a single label', () => {
  expect(serviceCandidates('platform')).toEqual(['platform']);
  expect(projectCandidates('tale', 'platform')).toEqual(['tale']);
});

test('unknown project scopes to any (undefined)', () => {
  expect(projectCandidates(undefined, 'convex')).toBeUndefined();
});
