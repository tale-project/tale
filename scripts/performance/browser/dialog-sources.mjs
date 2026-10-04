import assert from 'node:assert/strict';

export const dialogProductPair = Object.freeze({
  baseline: 'a9a19afdcc68b7114af8bace6b8db74ba1696c2f',
  candidate: '8a9da5114b3848501e5c4be02909f4d47674509b',
});

/** Explicit exclusive dialog admission selects an immutable diagnostic pair;
 * the current PR event base is retained, never presented as the measured base. */
export function dialogAdmission(eventName, eventBaseline) {
  assert(
    ['pull_request', 'workflow_dispatch'].includes(eventName),
    'Unknown dialog event',
  );
  assert.match(
    eventBaseline ?? '',
    /^[a-f0-9]{40}$/,
    'Malformed event baseline',
  );
  if (eventName === 'workflow_dispatch')
    assert.equal(
      eventBaseline,
      dialogProductPair.baseline,
      'Dispatch must explicitly request the frozen dialog baseline',
    );
  return {
    eventName,
    eventBaseline,
    baseline: dialogProductPair.baseline,
    productCandidate: dialogProductPair.candidate,
    selection:
      'Explicit dialog mode pins the diagnostic pair independently of the current PR base; no acceptance claim',
  };
}

/** A new harness commit may only extend the reviewed, frozen product pair.
 * Only diagnostic admission selects this pair; other modes retain event sources. */
export function assertDialogSources(baseline, changes) {
  assert.equal(baseline, dialogProductPair.baseline, 'Dialog baseline drifted');
  assert(
    Array.isArray(changes) && changes.every((path) => typeof path === 'string'),
  );
  const unexpected = changes.filter(
    (path) =>
      !(
        (path.startsWith('scripts/performance/browser/') &&
          !path.split('/').includes('..')) ||
        /^scripts\/performance\/browser-[a-z0-9-]+\.test\.ts$/.test(path) ||
        path === 'scripts/performance/README.md' ||
        path === '.github/workflows/browser-performance.yml' ||
        path === 'services/platform/tests/manual/reference/automation.md'
      ),
  );
  assert.deepEqual(
    unexpected,
    [],
    `Dialog product source drift: ${unexpected.join(', ')}`,
  );
  return { ...dialogProductPair, harnessOnlyChanges: changes };
}
