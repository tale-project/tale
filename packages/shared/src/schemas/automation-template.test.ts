import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_BRAND_ICONS,
  automationPackManifestSchema,
  brandOfIcon,
} from './automation-pack';
import {
  automationTemplateManifestSchema,
  shippedPackManifestSchema,
  templateAnswersSchema,
} from './automation-template';

/** The smallest template the contract takes, with whatever a case adds. */
function template(
  overrides: {
    template?: Record<string, unknown>;
    [key: string]: unknown;
  } = {},
) {
  return {
    name: 'Sync issues',
    category: 'issues',
    icon: 'brand:github',
    triggers: [
      {
        kind: 'schedule',
        repeat: { frequency: 'hourly', interval: 1, minute: 0 },
        timezone: 'UTC',
        input: { owner: 'your-organization' },
      },
    ],
    template: {
      details: 'Keeps tasks in step with issues.',
      steps: [{ title: 'Reads the issues' }],
      outcomes: [{ kind: 'creates', text: 'A task per issue.' }],
      fields: [],
      ...overrides.template,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'template'),
    ),
  };
}

/** The messages of what the contract refuses. */
function refusals(value: unknown): string[] {
  const parsed = automationTemplateManifestSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
}

describe('a manifest’s icon and category', () => {
  it('takes a lucide name or the logo of a brand Tale ships, and nothing else after brand:', () => {
    expect(
      automationPackManifestSchema.safeParse({ name: 'x', icon: 'webhook' })
        .success,
    ).toBe(true);
    for (const brand of AUTOMATION_BRAND_ICONS) {
      expect(
        automationPackManifestSchema.safeParse({
          name: 'x',
          icon: `brand:${brand}`,
        }).success,
      ).toBe(true);
      expect(brandOfIcon(`brand:${brand}`)).toBe(brand);
    }
    expect(
      automationPackManifestSchema.safeParse({
        name: 'x',
        icon: 'brand:myspace',
      }).success,
    ).toBe(false);
    expect(brandOfIcon('webhook')).toBeNull();
    expect(brandOfIcon(undefined)).toBeNull();
  });

  it('asks a template its category, a plain pack only when it carries a template', () => {
    expect(refusals(template())).toEqual([]);
    const { category: _category, ...uncategorized } = template();
    expect(
      automationTemplateManifestSchema.safeParse(uncategorized).success,
    ).toBe(false);
    // A shipped pack without a template block needs no category …
    expect(shippedPackManifestSchema.safeParse({ name: 'Old' }).success).toBe(
      true,
    );
    // … and one with a template block does.
    expect(
      shippedPackManifestSchema
        .safeParse(uncategorized)
        .error?.issues.map((issue) => issue.message),
    ).toContain('a pack with a template block names its category');
    // An uploaded package keeps the plain pack contract: no template block.
    expect(automationPackManifestSchema.safeParse(template()).success).toBe(
      false,
    );
  });
});

describe('the template block', () => {
  it('needs its steps and its outcomes, and something it does besides what it never does', () => {
    expect(refusals(template({ template: { steps: [] } }))).not.toEqual([]);
    expect(refusals(template({ template: { outcomes: [] } }))).not.toEqual([]);
    expect(
      refusals(
        template({
          template: { outcomes: [{ kind: 'never', text: 'Never writes.' }] },
        }),
      ),
    ).toEqual(['a template says what it does, not only what it never does']);
  });

  it('names the templates it works with by their slugs', () => {
    expect(
      refusals(template({ template: { worksWith: ['gmail/sync-emails'] } })),
    ).toEqual([]);
    expect(
      refusals(template({ template: { worksWith: ['Not a slug'] } })),
    ).not.toEqual([]);
  });
});

describe('a template’s questions', () => {
  const question = (field: Record<string, unknown>) =>
    template({ template: { fields: [field] } });

  it('bounds a number question, and its default inside the bounds', () => {
    const number = {
      id: 'batch',
      kind: 'number',
      label: 'Batch',
      min: 1,
      max: 50,
      default: 25,
      writes: [{ trigger: true, pointer: '/input/owner' }],
    };
    expect(refusals(question(number))).toEqual([]);
    expect(refusals(question({ ...number, min: 60 }))).toContain(
      '"batch" has a minimum above its maximum',
    );
    expect(refusals(question({ ...number, default: 99 }))).toContain(
      '"batch" defaults to a number outside its bounds',
    );
    const { min: _min, ...unbounded } = number;
    expect(refusals(question(unbounded))).not.toEqual([]);
  });

  it('writes into a step or into the trigger’s fixed input, never elsewhere in the trigger', () => {
    const owner = {
      id: 'owner',
      kind: 'text',
      label: 'Owner',
      pattern: '^[a-z-]+$',
      placeholder: 'octocat',
    };
    expect(
      refusals(
        question({
          ...owner,
          writes: [{ trigger: true, pointer: '/input/owner' }],
        }),
      ),
    ).toEqual([]);
    expect(
      refusals(
        question({ ...owner, writes: [{ trigger: true, pointer: '/repeat' }] }),
      ),
    ).not.toEqual([]);
    expect(
      refusals(
        question({
          ...owner,
          writes: [{ trigger: true, pointer: '/input/owner' }],
        }),
      ),
    ).toEqual([]);
    // A trigger write needs a trigger to land in.
    expect(
      refusals({
        ...question({
          ...owner,
          writes: [{ trigger: true, pointer: '/input/owner' }],
        }),
        triggers: [],
      }),
    ).toContain(
      'a question writes into a trigger the template does not declare',
    );
    // A pattern must be a regular expression.
    expect(
      refusals(
        question({
          ...owner,
          pattern: '[unclosed',
          writes: [{ node: 'sync', pointer: '/input/owner' }],
        }),
      ),
    ).toContain('is not a regular expression');
  });

  it('takes a toggle, a list and an optional credential with its empty choice', () => {
    expect(
      refusals(
        template({
          template: {
            fields: [
              {
                id: 'closed',
                kind: 'toggle',
                label: 'Closed too',
                default: true,
                writes: [{ node: 'sync', pointer: '/input/closed' }],
              },
              {
                id: 'labels',
                kind: 'list',
                label: 'Labels',
                maxItems: 3,
                default: ['bug'],
                writes: [{ node: 'sync', pointer: '/input/labels' }],
              },
              {
                id: 'account',
                kind: 'credential',
                label: 'Account',
                connector: 'github',
                required: false,
                placeholder: 'The default GitHub connection',
                i18n: {
                  de: { placeholder: 'Die Standardverbindung zu GitHub' },
                },
                writes: [{ node: 'sync', pointer: '/credential' }],
              },
            ],
          },
        }),
      ),
    ).toEqual([]);
    expect(
      refusals(
        question({
          id: 'labels',
          kind: 'list',
          label: 'Labels',
          maxItems: 1,
          default: ['bug', 'ui'],
          writes: [{ node: 'sync', pointer: '/input/labels' }],
        }),
      ),
    ).toContain('"labels" defaults to a list it would refuse');
  });

  it('takes an answer of each kind on the wire', () => {
    expect(
      templateAnswersSchema.safeParse({
        owner: 'tale-project',
        batch: 25,
        closed: true,
        labels: ['bug'],
        schedule: { cron: '0 9 * * *', timezone: 'Europe/Zurich' },
      }).success,
    ).toBe(true);
    expect(
      templateAnswersSchema.safeParse({ owner: { nested: true } }).success,
    ).toBe(false);
  });
});
