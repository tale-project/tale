import { afterEach, describe, expect, it } from 'vitest';

import { AUTOMATION_REFUSAL_CODES } from '@/lib/shared/schemas/automation-refusals';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { automationRefusalText, refusalWords } from './refusal-text';

const LOCALES = ['en', 'de', 'fr'] as const;

// Every fact a refusal's data can carry, so each code reads its fullest
// sentence.
const FULL_DATA: Record<string, unknown> = {
  name: 'ops/daily-digest',
  latestVersion: 4,
  baseVersion: 3,
  deployedVersion: 4,
  expectedDeployedVersion: 3,
  version: 3,
  segment: 'new',
  position: 'last',
  reason: 'slot_freed_taken',
  connectors: ['Slack', 'Gmail'],
  nodes: ['send_digest'],
  issues: [{ path: 'owner', message: 'is required' }],
};

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('refusalWords', () => {
  it.each([
    [
      'a save that missed a version',
      'AUTOMATION_VERSION_STALE',
      { name: 'ops/greet', latestVersion: 6, baseVersion: 5 },
      'AUTOMATION_VERSION_STALE.saved',
      { name: 'ops/greet', latest: 6, base: 5 },
    ],
    [
      'a save whose automation has no version any more',
      'AUTOMATION_VERSION_STALE',
      { name: 'ops/greet', latestVersion: null, baseVersion: 5 },
      'AUTOMATION_VERSION_STALE.savedGone',
      { name: 'ops/greet', base: 5 },
    ],
    [
      'a delete that missed a version',
      'AUTOMATION_VERSION_STALE',
      { name: 'ops/greet', latestVersion: 5, expectedLatestVersion: 4 },
      'AUTOMATION_VERSION_STALE.deleted',
      { name: 'ops/greet', latest: 5, expected: 4 },
    ],
    [
      'a delete whose automation has no version any more',
      'AUTOMATION_VERSION_STALE',
      { name: 'ops/greet', latestVersion: null, expectedLatestVersion: 4 },
      'AUTOMATION_VERSION_STALE.deletedGone',
      { name: 'ops/greet' },
    ],
    [
      'a stale write from a server that names no automation',
      'AUTOMATION_VERSION_STALE',
      { latestVersion: 6, baseVersion: 5 },
      'AUTOMATION_VERSION_STALE.general',
      {},
    ],
    [
      'a deploy whose live version was taken down',
      'AUTOMATION_DEPLOYMENT_STALE',
      { deployedVersion: null, expectedDeployedVersion: 3 },
      'AUTOMATION_DEPLOYMENT_STALE.gone',
      { expected: 3 },
    ],
    [
      'a deploy whose live version moved',
      'AUTOMATION_DEPLOYMENT_STALE',
      { deployedVersion: 4, expectedDeployedVersion: 3 },
      'AUTOMATION_DEPLOYMENT_STALE.moved',
      { live: 4, expected: 3 },
    ],
    [
      'a deploy that expected nothing live',
      'AUTOMATION_DEPLOYMENT_STALE',
      { deployedVersion: 4, expectedDeployedVersion: null },
      'AUTOMATION_DEPLOYMENT_STALE.movedFromNone',
      { live: 4 },
    ],
    [
      "the deploy gate's refusal of a version saved with failing tests",
      'AUTOMATION_DEPLOY_REJECTED',
      { name: 'ops/greet', version: 3 },
      'AUTOMATION_DEPLOY_REJECTED.failingTests',
      { name: 'ops/greet', version: 3 },
    ],
    [
      'a deploy refusal that names no version',
      'AUTOMATION_DEPLOY_REJECTED',
      {},
      'AUTOMATION_DEPLOY_REJECTED.general',
      {},
    ],
    [
      'a name that starts with a reserved word',
      'AUTOMATION_NAME_RESERVED',
      { name: 'runs/digest', segment: 'runs', position: 'first' },
      'AUTOMATION_NAME_RESERVED.first',
      { name: 'runs/digest', segment: 'runs', example: 'ops/runs/digest' },
    ],
    [
      'a name that ends with a reserved word',
      'AUTOMATION_NAME_RESERVED',
      { name: 'ops/new', segment: 'new', position: 'last' },
      'AUTOMATION_NAME_RESERVED.last',
      { name: 'ops/new', segment: 'new', example: 'ops/new-flow' },
    ],
    [
      'a reserved name the refusal does not place',
      'AUTOMATION_NAME_RESERVED',
      { name: 'ops/new' },
      'AUTOMATION_NAME_RESERVED.general',
      {},
    ],
    [
      'a name that is taken',
      'AUTOMATION_NAME_TAKEN',
      { name: 'ops/greet' },
      'AUTOMATION_NAME_TAKEN.named',
      { name: 'ops/greet' },
    ],
    [
      'a taken name the refusal does not name',
      'AUTOMATION_NAME_TAKEN',
      {},
      'AUTOMATION_NAME_TAKEN.general',
      {},
    ],
    [
      'a freed-slot wake another schedule holds',
      'AUTOMATION_TRIGGER_INVALID',
      { reason: 'slot_freed_taken', name: 'ops/other-manager' },
      'AUTOMATION_TRIGGER_INVALID.slotFreedTakenNamed',
      { name: 'ops/other-manager' },
    ],
    [
      'a freed-slot wake taken by a schedule the refusal does not name',
      'AUTOMATION_TRIGGER_INVALID',
      { reason: 'slot_freed_taken' },
      'AUTOMATION_TRIGGER_INVALID.slotFreedTaken',
      {},
    ],
    [
      'any other trigger refusal',
      'AUTOMATION_TRIGGER_INVALID',
      { issues: [{ path: 'cron', code: 'cron_invalid', message: 'x' }] },
      'AUTOMATION_TRIGGER_INVALID.general',
      {},
    ],
    [
      'a version that does not exist, beside the latest one',
      'AUTOMATION_VERSION_UNKNOWN',
      { latestVersion: 4 },
      'AUTOMATION_VERSION_UNKNOWN.withLatest',
      { latest: 4 },
    ],
    [
      'a version that does not exist',
      'AUTOMATION_VERSION_UNKNOWN',
      {},
      'AUTOMATION_VERSION_UNKNOWN.general',
      {},
    ],
    [
      'a template whose services are not connected',
      'TEMPLATE_CONNECTION_MISSING',
      { connectors: ['Slack'] },
      'TEMPLATE_CONNECTION_MISSING.named',
      { connectors: 'Slack' },
    ],
    [
      'an input the automation does not take, at a field',
      'AUTOMATION_INPUT_INVALID',
      { issues: [{ path: 'owner', message: 'is required' }], version: 2 },
      'AUTOMATION_INPUT_INVALID.field',
      { field: 'owner' },
    ],
    [
      'an input the automation does not take as a whole',
      'AUTOMATION_INPUT_INVALID',
      { issues: [{ path: '', message: 'must be object' }] },
      'AUTOMATION_INPUT_INVALID.general',
      {},
    ],
    [
      'a refusal with one sentence',
      'RUN_QUARANTINED',
      { quarantinedRunIds: ['r1'] },
      'RUN_QUARANTINED',
      {},
    ],
  ] as const)('words %s', (_case, code, data, key, values) => {
    expect(refusalWords(code, data)).toEqual({ key, values });
  });

  it("reads a replay refusal as the replay dialog's explanation", () => {
    expect(
      refusalWords('REPLAY_NODE_UNKNOWN', { nodes: ['send_digest'] }),
    ).toEqual({
      replay: 'REPLAY_NODE_UNKNOWN',
      part: 'body',
      values: { step: 'send digest' },
    });
    expect(refusalWords('REPLAY_GRAPH_CHANGED', {})).toEqual({
      replay: 'REPLAY_GRAPH_CHANGED',
      part: 'title',
      values: {},
    });
  });
});

describe('automationRefusalText', () => {
  it('words a stale save with the versions it names', () => {
    expect(
      automationRefusalText('AUTOMATION_VERSION_STALE', {
        name: 'ops/greet',
        latestVersion: 6,
        baseVersion: 5,
      }),
    ).toBe(
      'v6 of "ops/greet" was saved after your draft started from v5. Reload to see it, or save anyway to add your version on top of it.',
    );
  });

  it("words a stale save in the reader's language", async () => {
    await i18n.changeLanguage('de');
    expect(
      automationRefusalText('AUTOMATION_VERSION_STALE', {
        name: 'ops/greet',
        latestVersion: 6,
        baseVersion: 5,
      }),
    ).toBe(
      'v6 von "ops/greet" wurde gespeichert, nachdem dein Entwurf von v5 ausging. Lade neu, um sie zu sehen, oder speichere trotzdem, um deine Version darüber anzulegen.',
    );
  });

  it("lists the services to connect in the reader's language", async () => {
    const data = { connectors: ['Slack', 'Gmail'] };
    expect(
      automationRefusalText('TEMPLATE_CONNECTION_MISSING', data),
    ).toContain('Slack and Gmail');
    await i18n.changeLanguage('de');
    expect(
      automationRefusalText('TEMPLATE_CONNECTION_MISSING', data),
    ).toContain('Slack und Gmail');
    await i18n.changeLanguage('fr');
    expect(
      automationRefusalText('TEMPLATE_CONNECTION_MISSING', data),
    ).toContain('Slack et Gmail');
  });

  it("reads a replay refusal in the replay dialog's words", () => {
    expect(
      automationRefusalText('REPLAY_NODE_UNKNOWN', { nodes: ['send_digest'] }),
    ).toBe(
      "send digest isn't in both this run's version and the version to run.",
    );
  });

  describe.each([
    ['its fullest sentence', FULL_DATA],
    ['its general sentence', {}],
  ])('every code, with %s', (_case, data) => {
    it.each(AUTOMATION_REFUSAL_CODES)(
      '%s reads a whole sentence in every locale',
      async (code) => {
        const english = automationRefusalText(code, data);
        for (const locale of LOCALES) {
          await i18n.changeLanguage(locale);
          const sentence = automationRefusalText(code, data);
          expect(sentence).not.toMatch(/[{}]|refusals\.|replay\.refusal\./);
          expect(sentence.trim().length).toBeGreaterThan(0);
          if (locale !== 'en') expect(sentence).not.toBe(english);
        }
      },
    );
  });
});
