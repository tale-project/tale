import { describe, expect, test } from 'bun:test';

import { CliError, ExitCode } from '../../utils/fail';
import {
  APP_IN_BACKEND_LABEL,
  SPLIT,
  THREE_WAY,
  UNIFIED,
  apiService,
  appTierFor,
  appTierOfPlatformRole,
  askedAppTier,
  describeReplicas,
  imageServesAppInBackend,
  tierReplicaCounts,
  unusedReplicaVariables,
} from './app-tier';
import { ROTATABLE_SERVICES } from './types';

/** An environment that holds exactly these variables. */
const reading =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];
const quiet = (): void => {};

describe('the shapes of a colour', () => {
  test('every shape runs platform, names a role for each service it runs, and no other', () => {
    for (const tier of [UNIFIED, SPLIT, THREE_WAY]) {
      expect(tier.services).toContain('platform');
      expect(Object.keys(tier.roles).toSorted()).toEqual(
        [...tier.services].toSorted(),
      );
      for (const service of tier.services)
        expect(ROTATABLE_SERVICES).toContain(service);
    }
  });

  test('platform starts in a role of its own in each, so its role names the shape', () => {
    expect(UNIFIED.roles.platform).toBe('all');
    expect(SPLIT.roles.platform).toBe('api');
    expect(THREE_WAY.roles.platform).toBe('web');
    expect(appTierOfPlatformRole('all')).toBe(UNIFIED);
    expect(appTierOfPlatformRole('api')).toBe(SPLIT);
    expect(appTierOfPlatformRole('web')).toBe(THREE_WAY);
  });

  test('a platform that names no role is the web tier, as a colour of three services has always started it', () => {
    expect(appTierOfPlatformRole(undefined)).toBe(THREE_WAY);
  });

  test('a word that is no role of platform names no shape', () => {
    expect(appTierOfPlatformRole('worker')).toBeNull();
    expect(appTierOfPlatformRole('')).toBeNull();
    expect(appTierOfPlatformRole('ALL')).toBeNull();
  });

  test('the jobs run in every shape: in platform, or in a worker beside it', () => {
    for (const tier of [UNIFIED, SPLIT, THREE_WAY]) {
      const roles = Object.values(tier.roles);
      expect(roles.includes('all') || roles.includes('worker')).toBe(true);
      expect(roles.includes('all') && roles.includes('worker')).toBe(false);
    }
  });

  test('the API answers on platform unless the colour has a backend-api', () => {
    expect(apiService(UNIFIED)).toBe('platform');
    expect(apiService(SPLIT)).toBe('platform');
    expect(apiService(THREE_WAY)).toBe('backend-api');
    for (const tier of [UNIFIED, SPLIT, THREE_WAY]) {
      expect(tier.services).toContain(apiService(tier));
      expect(['api', 'all']).toContain(tier.roles[apiService(tier)] ?? '');
    }
  });
});

describe('what an image says of itself', () => {
  test('the label, at exactly 1', () => {
    expect(imageServesAppInBackend({ [APP_IN_BACKEND_LABEL]: '1' })).toBe(true);
  });

  test('missing metadata is an old image, never evidence of the new shape', () => {
    expect(imageServesAppInBackend(undefined)).toBe(false);
    expect(imageServesAppInBackend(null)).toBe(false);
    expect(imageServesAppInBackend({})).toBe(false);
    for (const value of ['', '0', 'true', '2', ' 1', '1 '])
      expect(imageServesAppInBackend({ [APP_IN_BACKEND_LABEL]: value })).toBe(
        false,
      );
    expect(
      imageServesAppInBackend({ 'io.tale.automation-writer-protocol': '2' }),
    ).toBe(false);
  });
});

describe('the shape a new colour gets', () => {
  test('one process, unless the deployment asks for more', () => {
    expect(appTierFor({ appInBackend: true }, reading({}))).toBe(UNIFIED);
    expect(
      appTierFor(
        { appInBackend: true },
        reading({ TALE_PLATFORM_REPLICAS: '3' }),
      ),
    ).toBe(UNIFIED);
  });

  test('the job runners apart once a backend replica count is set, to any value', () => {
    for (const name of [
      'TALE_BACKEND_API_REPLICAS',
      'TALE_BACKEND_WORKER_REPLICAS',
    ])
      for (const value of ['1', '2', '0', 'many'])
        expect(
          appTierFor({ appInBackend: true }, reading({ [name]: value })),
        ).toBe(SPLIT);
  });

  test('a blank backend replica count asks for nothing', () => {
    expect(
      appTierFor(
        { appInBackend: true },
        reading({
          TALE_BACKEND_API_REPLICAS: '',
          TALE_BACKEND_WORKER_REPLICAS: '  ',
        }),
      ),
    ).toBe(UNIFIED);
  });

  test('three services for an image that cannot serve the app from its backend, whatever is asked', () => {
    expect(appTierFor({ appInBackend: false }, reading({}))).toBe(THREE_WAY);
    expect(
      appTierFor(
        { appInBackend: false },
        reading({ TALE_BACKEND_WORKER_REPLICAS: '2' }),
      ),
    ).toBe(THREE_WAY);
  });
});

describe('a shape named outright (TALE_APP_TIER)', () => {
  test('each word asks for its shape, and no word asks for none', () => {
    expect(askedAppTier(reading({ TALE_APP_TIER: 'one-process' }))).toBe(
      UNIFIED,
    );
    expect(askedAppTier(reading({ TALE_APP_TIER: 'workers-apart' }))).toBe(
      SPLIT,
    );
    expect(askedAppTier(reading({ TALE_APP_TIER: 'three-services' }))).toBe(
      THREE_WAY,
    );
    expect(askedAppTier(reading({ TALE_APP_TIER: ' three-services ' }))).toBe(
      THREE_WAY,
    );
    expect(askedAppTier(reading({}))).toBeNull();
    expect(askedAppTier(reading({ TALE_APP_TIER: '' }))).toBeNull();
    expect(askedAppTier(reading({ TALE_APP_TIER: '  ' }))).toBeNull();
  });

  test('a word that is no shape is refused with the ones that are, never guessed', () => {
    for (const value of [
      'three',
      'unified',
      'Three-Services',
      '3',
      'true',
      'constructor',
      'one-process,workers-apart',
    ]) {
      const read = reading({ TALE_APP_TIER: value });
      let failure: unknown;
      try {
        askedAppTier(read);
      } catch (error) {
        failure = error;
      }
      expect(failure, value).toBeInstanceOf(CliError);
      expect((failure as CliError).info.code).toBe(ExitCode.Precondition);
      expect((failure as CliError).message).toBe(
        `TALE_APP_TIER must be one-process, workers-apart, three-services, or unset; got: ${JSON.stringify(value)}`,
      );
      // The same refusal whatever the image is, so it never depends on a pull.
      expect(() => appTierFor({ appInBackend: true }, read)).toThrow(
        'TALE_APP_TIER must be',
      );
      expect(() => appTierFor({ appInBackend: false }, read)).toThrow(
        'TALE_APP_TIER must be',
      );
    }
  });

  test('the word wins over what the replica counts would ask for', () => {
    const counts = { TALE_BACKEND_WORKER_REPLICAS: '3' };
    expect(appTierFor({ appInBackend: true }, reading(counts))).toBe(SPLIT);
    expect(
      appTierFor(
        { appInBackend: true },
        reading({ ...counts, TALE_APP_TIER: 'one-process' }),
      ),
    ).toBe(UNIFIED);
    expect(
      appTierFor(
        { appInBackend: true },
        reading({ ...counts, TALE_APP_TIER: 'three-services' }),
      ),
    ).toBe(THREE_WAY);
    expect(
      appTierFor(
        { appInBackend: true },
        reading({ TALE_APP_TIER: 'workers-apart' }),
      ),
    ).toBe(SPLIT);
    // Three services with an image that could be one process: what a
    // workspace asks for before it goes back to an older CLI.
    expect(
      appTierFor(
        { appInBackend: true },
        reading({ TALE_APP_TIER: 'three-services' }),
      ),
    ).toBe(THREE_WAY);
  });

  test('no word makes an image that needs three services run as fewer', () => {
    for (const value of ['one-process', 'workers-apart', 'three-services'])
      expect(
        appTierFor({ appInBackend: false }, reading({ TALE_APP_TIER: value })),
      ).toBe(THREE_WAY);
  });

  test('a backend count beside one process scales nothing, and is named as such', () => {
    const both = reading({
      TALE_APP_TIER: 'one-process',
      TALE_BACKEND_API_REPLICAS: '2',
      TALE_BACKEND_WORKER_REPLICAS: '3',
    });
    expect(unusedReplicaVariables(UNIFIED, both)).toEqual([
      'TALE_BACKEND_API_REPLICAS',
      'TALE_BACKEND_WORKER_REPLICAS',
    ]);
    expect(
      unusedReplicaVariables(
        UNIFIED,
        reading({ TALE_BACKEND_WORKER_REPLICAS: '3' }),
      ),
    ).toEqual(['TALE_BACKEND_WORKER_REPLICAS']);
    expect(unusedReplicaVariables(UNIFIED, reading({}))).toEqual([]);
    expect(
      unusedReplicaVariables(UNIFIED, reading({ TALE_PLATFORM_REPLICAS: '2' })),
    ).toEqual([]);
    // Every count has a service in the other two shapes.
    expect(unusedReplicaVariables(SPLIT, both)).toEqual([]);
    expect(unusedReplicaVariables(THREE_WAY, both)).toEqual([]);
  });
});

describe('how many replicas each service of a colour runs', () => {
  test('one of each service the shape has, none of the others', () => {
    expect(tierReplicaCounts(UNIFIED, reading({}), quiet)).toEqual({
      platform: 1,
      'backend-api': 0,
      'backend-worker': 0,
    });
    expect(tierReplicaCounts(SPLIT, reading({}), quiet)).toEqual({
      platform: 1,
      'backend-api': 0,
      'backend-worker': 1,
    });
    expect(tierReplicaCounts(THREE_WAY, reading({}), quiet)).toEqual({
      platform: 1,
      'backend-api': 1,
      'backend-worker': 1,
    });
  });

  test('each count follows its variable where the shape has the service', () => {
    const asked = reading({
      TALE_PLATFORM_REPLICAS: '2',
      TALE_BACKEND_API_REPLICAS: '3',
      TALE_BACKEND_WORKER_REPLICAS: '4',
    });
    expect(tierReplicaCounts(THREE_WAY, asked, quiet)).toEqual({
      platform: 2,
      'backend-api': 3,
      'backend-worker': 4,
    });
    expect(tierReplicaCounts(UNIFIED, asked, quiet)).toEqual({
      platform: 2,
      'backend-api': 0,
      'backend-worker': 0,
    });
  });

  test('where platform is the API too, it runs the larger of the two counts asked', () => {
    expect(
      tierReplicaCounts(
        SPLIT,
        reading({
          TALE_PLATFORM_REPLICAS: '2',
          TALE_BACKEND_API_REPLICAS: '3',
          TALE_BACKEND_WORKER_REPLICAS: '4',
        }),
        quiet,
      ),
    ).toEqual({ platform: 3, 'backend-api': 0, 'backend-worker': 4 });
    expect(
      tierReplicaCounts(
        SPLIT,
        reading({
          TALE_PLATFORM_REPLICAS: '5',
          TALE_BACKEND_API_REPLICAS: '2',
        }),
        quiet,
      ),
    ).toEqual({ platform: 5, 'backend-api': 0, 'backend-worker': 1 });
  });

  test('a count out of range is clamped with a warning, as before', () => {
    const warnings: string[] = [];
    expect(
      tierReplicaCounts(
        UNIFIED,
        reading({ TALE_PLATFORM_REPLICAS: '0' }),
        (message) => warnings.push(message),
      ).platform,
    ).toBe(1);
    expect(warnings).toEqual([
      expect.stringContaining('TALE_PLATFORM_REPLICAS=0 is out of range'),
    ]);
  });

  test('a count the shape has no use for is not read, so it is never clamped aloud', () => {
    const warnings: string[] = [];
    const warn = (message: string): void => {
      warnings.push(message);
    };
    const asked = reading({
      TALE_APP_TIER: 'one-process',
      TALE_BACKEND_API_REPLICAS: '99',
      TALE_BACKEND_WORKER_REPLICAS: '0',
    });
    expect(tierReplicaCounts(UNIFIED, asked, warn)).toEqual({
      platform: 1,
      'backend-api': 0,
      'backend-worker': 0,
    });
    expect(warnings).toEqual([]);
    // Where the services run, the same values are clamped and said.
    expect(tierReplicaCounts(THREE_WAY, asked, warn)).toEqual({
      platform: 1,
      'backend-api': 16,
      'backend-worker': 1,
    });
    expect(warnings).toEqual([
      expect.stringContaining('TALE_BACKEND_API_REPLICAS=99 is out of range'),
      expect.stringContaining('TALE_BACKEND_WORKER_REPLICAS=0 is out of range'),
    ]);
  });

  test('a log line names the services of the shape only', () => {
    expect(
      describeReplicas(UNIFIED, tierReplicaCounts(UNIFIED, reading({}), quiet)),
    ).toBe('platform×1');
    expect(
      describeReplicas(
        SPLIT,
        tierReplicaCounts(
          SPLIT,
          reading({ TALE_BACKEND_WORKER_REPLICAS: '2' }),
          quiet,
        ),
      ),
    ).toBe('platform×1, backend-worker×2');
    expect(
      describeReplicas(
        THREE_WAY,
        tierReplicaCounts(THREE_WAY, reading({}), quiet),
      ),
    ).toBe('platform×1, backend-api×1, backend-worker×1');
  });
});
