import { describe, expect, test } from 'bun:test';

import type { IncusClient } from '@tale/incus/client';
import type { FakeIncus } from '@tale/incus/fake';

import type { DesiredStack, PlanScope } from '../plan/plan';
import {
  clientOf,
  converge,
  desiredOf,
  goldenTarget,
  holdings,
  planned,
  recordingHooks,
  renderedFiles,
  stackIncus,
  stateRootFixture,
  testKey,
  withNewImage,
} from './apply-fixture';
import { readJournal } from './journal';

/**
 * The crash-resume property (design D-07, D-12): stop the applier after
 * every write it makes, in every phase, as a crash would (the write landed,
 * its answer is lost, nothing is cleaned up); the next run plans again from
 * what the node holds and converges to exactly what an uninterrupted run
 * makes, after which a plan is empty.
 */

class Crash extends Error {}
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A client whose `limit`-th write lands and then never answers. */
function crashing(fake: FakeIncus, limit: number) {
  let writes = 0;
  const client = clientOf(fake, (fetch) => async (url, init) => {
    const response = await fetch(url, init);
    if (WRITES.has(init.method)) {
      writes += 1;
      if (writes === limit) throw new Crash(`crashed after write ${limit}`);
    }
    return response;
  });
  return { client, writes: () => writes };
}

interface Scenario {
  name: string;
  /** What the node holds before the run that crashes. */
  before?: DesiredStack;
  desired: DesiredStack;
  scope: PlanScope;
}

const base = desiredOf(goldenTarget('managed-compose'));
const upgraded = (() => {
  let target = withNewImage(base.target, 'tale-platform', '9'.repeat(64));
  target = withNewImage(target, 'tale-sandbox', '8'.repeat(64));
  target = withNewImage(target, 'tale-db', '7'.repeat(64));
  target.instances = target.instances.filter(
    (spec) => spec.name !== 'bgutil-provider',
  );
  return desiredOf(target, testKey(), renderedFiles(target, 'v2'));
})();

const SCENARIOS: Scenario[] = [
  {
    name: 'a first deploy',
    desired: base,
    scope: { phase: 'full', stop: false },
  },
  {
    name: 'a release upgrade with --stop (replace, drain, withdraw, delete, new records)',
    before: base,
    desired: upgraded,
    scope: { phase: 'full', stop: true },
  },
];

async function prepared(scenario: Scenario) {
  const fake = stackIncus();
  const state = stateRootFixture();
  if (scenario.before) {
    const client = clientOf(fake);
    await converge(
      client,
      recordingHooks(fake, client),
      state.root,
      scenario.before,
    );
  }
  return { fake, state };
}

async function run(
  client: IncusClient,
  fake: FakeIncus,
  root: string,
  scenario: Scenario,
) {
  return converge(
    client,
    recordingHooks(fake, client),
    root,
    scenario.desired,
    scenario.scope,
  );
}

describe('crash-resume', () => {
  for (const scenario of SCENARIOS)
    test(`${scenario.name}: a crash after any write converges on the next run`, async () => {
      // The uninterrupted run: what it makes, and how many writes it takes.
      const reference = await prepared(scenario);
      const counted = crashing(reference.fake, Number.POSITIVE_INFINITY);
      await run(counted.client, reference.fake, reference.state.root, scenario);
      const expected = holdings(reference.fake);
      const total = counted.writes();
      reference.fake.close();
      reference.state.remove();
      expect(total).toBeGreaterThan(10);

      for (let limit = 1; limit <= total; limit += 1) {
        const { fake, state } = await prepared(scenario);
        try {
          const broken = crashing(fake, limit);
          const error = await run(
            broken.client,
            fake,
            state.root,
            scenario,
          ).then(
            () => undefined,
            (caught: unknown) => caught,
          );
          expect(error, `write ${limit} of ${total}`).toBeInstanceOf(Crash);
          expect((await readJournal(state.root))?.phase).toBe('pending');
          // Let the operations the lost answers started finish.
          await Bun.sleep(1);

          const client = clientOf(fake);
          await run(client, fake, state.root, scenario);
          expect(holdings(fake), `after a crash at write ${limit}`).toEqual(
            expected,
          );
          const again = await planned(client, scenario.desired, scenario.scope);
          expect(
            again.plan.resources.filter((item) => item.action !== 'unchanged'),
            `the plan after a crash at write ${limit}`,
          ).toEqual([]);
          const journal = await readJournal(state.root);
          expect(journal?.phase).toBe('ready');
          expect(journal?.withdrawn).toEqual([]);
        } finally {
          fake.close();
          state.remove();
        }
      }
    }, 240_000);
});
