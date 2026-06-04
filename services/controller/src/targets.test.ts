import { expect, test } from 'bun:test';

import { projectCandidates, serviceCandidates } from './targets.ts';

// Contract guard for the blue-green deploy topology. The CLI's
// generate-color-compose emits service `rag-<color>` under project
// `<project>-<color>` (see its companion test in tools/cli); these candidates
// must cover that, or "Apply & restart" silently matches zero rag containers.
test('rotatable rag expands to blue/green service + project candidates', () => {
  expect(serviceCandidates('rag')).toEqual(['rag', 'rag-blue', 'rag-green']);
  expect(projectCandidates('tale', 'rag')).toEqual([
    'tale',
    'tale-blue',
    'tale-green',
  ]);
});

test('stateful convex stays a single label under the base project', () => {
  expect(serviceCandidates('convex')).toEqual(['convex']);
  expect(projectCandidates('tale', 'convex')).toEqual(['tale']);
});

test('unknown project scopes to any (undefined)', () => {
  expect(projectCandidates(undefined, 'rag')).toBeUndefined();
});
