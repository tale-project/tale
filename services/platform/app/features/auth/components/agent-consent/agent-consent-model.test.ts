import { describe, expect, it } from 'vitest';

import {
  AGENT_SCOPES,
  type AgentScope,
  EXTRA_SCOPES,
  scopeCeilingForRole,
} from '@/lib/shared/agent-access';

import {
  type AccessChoice,
  type ConsentOffer,
  chosenScopes,
  defaultOrganizationId,
  isChoiceOnOffer,
  extraAvailability,
  initialChoice,
  levelAvailability,
  summaryOf,
  withExtra,
} from './agent-consent-model';

/** An offer from the words a test cares about. */
function offer(requested: readonly string[], ceiling: readonly string[]) {
  return {
    requested: new Set(requested),
    ceiling: new Set(ceiling),
  } satisfies ConsentOffer;
}

const EVERYTHING = ['offline_access', ...AGENT_SCOPES];
const DEVELOPER = scopeCeilingForRole('developer');
const MEMBER = scopeCeilingForRole('member');

describe('the levels and extras on offer [AGCONN-R8]', () => {
  it('offers every level and extra when the app asked for all and the role allows all', () => {
    const full = offer(EVERYTHING, DEVELOPER);
    for (const level of ['read', 'edit', 'deploy'] as const) {
      expect(levelAvailability(level, full), level).toBeNull();
    }
    for (const extra of EXTRA_SCOPES) {
      expect(extraAvailability(extra, full), extra).toBeNull();
    }
  });

  it('says a role that only reads cannot edit, deploy or change anything, and that reading and reading settings are fine', () => {
    const reader = offer(EVERYTHING, MEMBER);
    expect(levelAvailability('read', reader)).toBeNull();
    expect(levelAvailability('edit', reader)).toBe('roleCannot');
    expect(levelAvailability('deploy', reader)).toBe('roleCannot');
    expect(extraAvailability('tale:settings.read', reader)).toBeNull();
    expect(extraAvailability('tale:settings.write', reader)).toBe('roleCannot');
    expect(extraAvailability('tale:subscriptions.connect', reader)).toBe(
      'roleCannot',
    );
  });

  it('says an app that did not ask for something cannot be given it, before the role is asked', () => {
    const narrow = offer(['tale:mcp', 'tale:settings.read'], MEMBER);
    expect(levelAvailability('read', narrow)).toBeNull();
    expect(levelAvailability('edit', narrow)).toBe('notRequested');
    expect(extraAvailability('tale:settings.read', narrow)).toBeNull();
    expect(extraAvailability('tale:subscriptions.connect', narrow)).toBe(
      'notRequested',
    );
  });

  it('needs reading settings as well as changing them for changing them to be on offer', () => {
    const onlyWrite = offer(['tale:mcp', 'tale:settings.write'], DEVELOPER);
    expect(extraAvailability('tale:settings.write', onlyWrite)).toBe(
      'notRequested',
    );
    const both = offer(
      ['tale:mcp', 'tale:settings.read', 'tale:settings.write'],
      DEVELOPER,
    );
    expect(extraAvailability('tale:settings.write', both)).toBeNull();
    const roleReadsOnly = offer(
      ['tale:mcp', 'tale:settings.read', 'tale:settings.write'],
      ['tale:mcp', 'tale:settings.write'],
    );
    expect(extraAvailability('tale:settings.write', roleReadsOnly)).toBe(
      'roleCannot',
    );
  });

  it('asks of connecting subscriptions only that it was asked for and allowed, not reading settings', () => {
    const asked = offer(['tale:mcp', 'tale:subscriptions.connect'], DEVELOPER);
    expect(extraAvailability('tale:subscriptions.connect', asked)).toBeNull();
    expect(extraAvailability('tale:settings.read', asked)).toBe('notRequested');
  });

  it('offers no level when reading and testing is not asked for or allowed', () => {
    expect(
      levelAvailability('read', offer(['tale:settings.read'], MEMBER)),
    ).toBe('notRequested');
    expect(levelAvailability('read', offer(EVERYTHING, []))).toBe('roleCannot');
  });
});

describe('what is chosen when the page opens [AGCONN-R9]', () => {
  it('is editing, with no extras, for an app that asks for everything the first time', () => {
    expect(initialChoice(offer(EVERYTHING, DEVELOPER), null)).toEqual({
      level: 'edit',
      extras: new Set(),
    });
  });

  it('is reading and testing where the role does not allow editing', () => {
    expect(initialChoice(offer(EVERYTHING, MEMBER), null)).toEqual({
      level: 'read',
      extras: new Set(),
    });
  });

  it('never starts on deploying without a choice made before', () => {
    const choice = initialChoice(offer(EVERYTHING, DEVELOPER), null);
    expect(choice?.level).not.toBe('deploy');
  });

  it('is what the person chose here before, for an app that asks for everything', () => {
    const before: AgentScope[] = [
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.read',
    ];
    expect(initialChoice(offer(EVERYTHING, DEVELOPER), before)).toEqual({
      level: 'deploy',
      extras: new Set(['tale:settings.read']),
    });
  });

  it('holds what was chosen before to what the role allows now', () => {
    const before: AgentScope[] = [
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.write',
    ];
    expect(initialChoice(offer(EVERYTHING, MEMBER), before)).toEqual({
      level: 'read',
      extras: new Set(),
    });
  });

  it('holds what was chosen before to the highest level the role allows, not to the lowest', () => {
    const editsOnly = offer(EVERYTHING, ['tale:mcp', 'tale:automations.write']);
    expect(
      initialChoice(editsOnly, [
        'tale:mcp',
        'tale:automations.write',
        'tale:automations.deploy',
      ]),
    ).toEqual({ level: 'edit', extras: new Set() });
  });

  it('reads a choice that held less than reading and testing as reading and testing', () => {
    expect(
      initialChoice(offer(EVERYTHING, DEVELOPER), ['tale:settings.read']),
    ).toEqual({ level: 'read', extras: new Set(['tale:settings.read']) });
  });

  it('takes an app that asks for less at its word, held to the role', () => {
    expect(
      initialChoice(
        offer(
          ['tale:mcp', 'tale:automations.write', 'tale:settings.read'],
          DEVELOPER,
        ),
        // What was chosen before does not widen a narrow request.
        ['tale:mcp', 'tale:automations.write', 'tale:automations.deploy'],
      ),
    ).toEqual({
      level: 'edit',
      extras: new Set(['tale:settings.read']),
    });
    expect(
      initialChoice(
        offer(
          ['tale:mcp', 'tale:automations.write', 'tale:automations.deploy'],
          MEMBER,
        ),
        null,
      ),
    ).toEqual({ level: 'read', extras: new Set() });
  });

  it('is nothing when no level can be chosen', () => {
    expect(
      initialChoice(offer(['tale:settings.read'], MEMBER), null),
    ).toBeNull();
    expect(initialChoice(offer(EVERYTHING, []), null)).toBeNull();
  });
});

describe('whether a choice still holds', () => {
  const choice = (
    level: AccessChoice['level'],
    ...extras: AccessChoice['extras'] extends ReadonlySet<infer T> ? T[] : never
  ): AccessChoice => ({ level, extras: new Set(extras) });

  it('does when its level and every extra are on offer, with none or with some', () => {
    const full = offer(EVERYTHING, DEVELOPER);
    expect(isChoiceOnOffer(choice('read'), full)).toBe(true);
    expect(
      isChoiceOnOffer(
        choice('deploy', 'tale:settings.read', 'tale:settings.write'),
        full,
      ),
    ).toBe(true);
  });

  it('does not when its level is no longer on offer, whatever its extras', () => {
    const reader = offer(EVERYTHING, MEMBER);
    expect(isChoiceOnOffer(choice('edit'), reader)).toBe(false);
    expect(isChoiceOnOffer(choice('edit', 'tale:settings.read'), reader)).toBe(
      false,
    );
  });

  it('does not when an extra is no longer on offer, however good its level', () => {
    const reader = offer(EVERYTHING, MEMBER);
    expect(isChoiceOnOffer(choice('read', 'tale:settings.write'), reader)).toBe(
      false,
    );
    expect(
      isChoiceOnOffer(
        choice('read', 'tale:settings.read', 'tale:subscriptions.connect'),
        reader,
      ),
    ).toBe(false);
  });
});

describe('the extras', () => {
  const start: AccessChoice = { level: 'edit', extras: new Set() };

  it('switch on and off', () => {
    const on = withExtra(start, 'tale:subscriptions.connect', true);
    expect(on.extras).toEqual(new Set(['tale:subscriptions.connect']));
    expect(withExtra(on, 'tale:subscriptions.connect', false).extras).toEqual(
      new Set(),
    );
  });

  it('bring reading settings along with changing them, and keep it while they can be changed', () => {
    const write = withExtra(start, 'tale:settings.write', true);
    expect(write.extras).toEqual(
      new Set(['tale:settings.write', 'tale:settings.read']),
    );
    expect(withExtra(write, 'tale:settings.read', false)).toBe(write);
    const released = withExtra(write, 'tale:settings.write', false);
    expect(released.extras).toEqual(new Set(['tale:settings.read']));
    expect(withExtra(released, 'tale:settings.read', false).extras).toEqual(
      new Set(),
    );
  });

  it('leave the level and the choice they came from alone', () => {
    const next = withExtra(start, 'tale:settings.read', true);
    expect(next.level).toBe('edit');
    expect(start.extras.size).toBe(0);
  });
});

describe('the scopes a choice makes', () => {
  it('are the level’s and the extras’, in the order the scopes are taught', () => {
    expect(
      chosenScopes({
        level: 'deploy',
        extras: new Set(['tale:subscriptions.connect', 'tale:settings.read']),
      }),
    ).toEqual([
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.read',
      'tale:subscriptions.connect',
    ]);
  });

  it('always hold reading and testing, and reading settings along with changing them', () => {
    expect(chosenScopes({ level: 'read', extras: new Set() })).toEqual([
      'tale:mcp',
    ]);
    expect(
      chosenScopes({ level: 'read', extras: new Set(['tale:settings.write']) }),
    ).toEqual(['tale:mcp', 'tale:settings.read', 'tale:settings.write']);
  });
});

describe('the lines of what the agent will be able to do', () => {
  it('list each scope the app asked for, what is allowed and what is not, and the role as the reason where it is the role', () => {
    const lines = summaryOf(
      { level: 'edit', extras: new Set(['tale:settings.read']) },
      offer(
        [
          'offline_access',
          'tale:mcp',
          'tale:automations.write',
          'tale:automations.deploy',
          'tale:settings.read',
          'tale:subscriptions.connect',
        ],
        ['tale:mcp', 'tale:automations.write', 'tale:settings.read'],
      ),
    );
    expect(lines).toEqual([
      { scope: 'tale:mcp', allowed: true },
      { scope: 'tale:automations.write', allowed: true },
      { scope: 'tale:automations.deploy', allowed: false, why: 'roleCannot' },
      { scope: 'tale:settings.read', allowed: true },
      {
        scope: 'tale:subscriptions.connect',
        allowed: false,
        why: 'roleCannot',
      },
    ]);
  });

  it('give a reason only for what is not allowed', () => {
    const lines = summaryOf(
      // Not a choice the page makes: one of more than the role allows.
      { level: 'deploy', extras: new Set() },
      offer(EVERYTHING, ['tale:mcp']),
    );
    expect(
      lines.find((line) => line.scope === 'tale:automations.write'),
    ).toEqual({ scope: 'tale:automations.write', allowed: true });
  });

  it('leave out what the app did not ask for, and give no reason for what the person left unchecked', () => {
    const lines = summaryOf(
      { level: 'read', extras: new Set() },
      offer(['tale:mcp', 'tale:automations.write'], DEVELOPER),
    );
    expect(lines).toEqual([
      { scope: 'tale:mcp', allowed: true },
      { scope: 'tale:automations.write', allowed: false },
    ]);
  });
});

describe('the organization to start on', () => {
  const orgs = [
    { id: 'beta', allowed: false },
    { id: 'acme', allowed: true },
    { id: 'cal', allowed: true },
  ];

  it('is the one the person is working in, when they may connect an agent there', () => {
    expect(defaultOrganizationId(orgs, 'cal')).toBe('cal');
  });

  it('is the first they may when that one is not allowed, unknown or absent', () => {
    expect(defaultOrganizationId(orgs, 'beta')).toBe('acme');
    expect(defaultOrganizationId(orgs, 'elsewhere')).toBe('acme');
    expect(defaultOrganizationId(orgs, null)).toBe('acme');
  });

  it('is none when they may connect nowhere', () => {
    expect(
      defaultOrganizationId([{ id: 'beta', allowed: false }], 'beta'),
    ).toBeNull();
    expect(defaultOrganizationId([], null)).toBeNull();
  });
});
