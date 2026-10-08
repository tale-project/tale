// @vitest-environment node

/**
 * The custom-instructions gate, on a fake `sql`: the person's explicit toggle
 * beats the org policy default, with neither set the feature is OFF, and
 * blank text reads as none even while it is on. The real-Postgres pass —
 * the gated block on the model's wire — rides `integration-check.ts`.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readGovernancePolicyForOrg } = vi.hoisted(() => ({
  readGovernancePolicyForOrg: vi.fn(),
}));

vi.mock('../../lib/org-config.ts', () => ({ readGovernancePolicyForOrg }));

import {
  effectiveCustomInstructions,
  getEffectiveCustomInstructions,
  upsertCustomInstructions,
} from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    return Promise.resolve(answer({ text, values }) ?? []);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reader exercises exactly the tag surface faked here
  return { sql: tag as unknown as Sql, statements };
}

const SCOPE = { userId: 'user_1', orgId: 'org_1' };

describe('upsertCustomInstructions length boundary [PREF-R1]', () => {
  it.each(['', 'a'.repeat(3200), 'a'.repeat(3199) + '\r\n'])(
    'stores text within the normalized 3200-character budget (%#)',
    async (text) => {
      const statements: unknown[][] = [];
      const tx = vi.fn(
        async (_strings: TemplateStringsArray, ...values: unknown[]) => {
          statements.push(values);
          return [];
        },
      ) as unknown as TransactionSql;
      await expect(
        upsertCustomInstructions(tx, SCOPE, text),
      ).resolves.toBeUndefined();
      expect(statements).toHaveLength(1);
      expect(statements[0]).toEqual([
        SCOPE.userId,
        SCOPE.orgId,
        text.replaceAll('\r\n', '\n'),
        expect.any(Number),
        text.replaceAll('\r\n', '\n'),
        expect.any(Number),
      ]);
    },
  );

  it.each([3201, 5000, 5001])(
    'refuses %i characters before touching saved text',
    async (length) => {
      const tx = vi.fn() as unknown as TransactionSql;
      await expect(
        upsertCustomInstructions(tx, SCOPE, 'a'.repeat(length)),
      ).rejects.toMatchObject({
        code: 'too_long',
        message: 'Custom instructions exceed 3200 characters.',
      });
      expect(tx).not.toHaveBeenCalled();
    },
  );
});

/** A preferences row as the SELECT answers it. */
function row(overrides: {
  customInstructions?: string;
  customInstructionsEnabled?: boolean | null;
}) {
  return {
    customInstructions: overrides.customInstructions ?? '',
    customInstructionsEnabled: overrides.customInstructionsEnabled ?? null,
    voiceOutput: null,
    chatModelId: null,
    chatModelProviderSlug: null,
    onboardingCompleted: null,
    updatedAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readGovernancePolicyForOrg.mockResolvedValue(null);
});

describe('effectiveCustomInstructions', () => {
  it('is OFF with neither a preference row nor a policy [PREF-R2]', () => {
    expect(effectiveCustomInstructions(null, null)).toBeNull();
  });

  it('follows the org default when the person has not chosen [PREF-R2]', () => {
    const preferences = { customInstructions: 'Be terse.' };
    expect(effectiveCustomInstructions(preferences, { enabled: true })).toBe(
      'Be terse.',
    );
    expect(
      effectiveCustomInstructions(preferences, { enabled: false }),
    ).toBeNull();
    expect(effectiveCustomInstructions(preferences, null)).toBeNull();
  });

  it('lets the person’s explicit choice beat the org default either way [PREF-R2]', () => {
    expect(
      effectiveCustomInstructions(
        { customInstructions: 'Be terse.', customInstructionsEnabled: false },
        { enabled: true },
      ),
    ).toBeNull();
    expect(
      effectiveCustomInstructions(
        { customInstructions: 'Be terse.', customInstructionsEnabled: true },
        { enabled: false },
      ),
    ).toBe('Be terse.');
    expect(
      effectiveCustomInstructions(
        { customInstructions: 'Be terse.', customInstructionsEnabled: true },
        null,
      ),
    ).toBe('Be terse.');
  });

  it('reads blank text as none even while the feature is on, and trims the rest [PREF-R3]', () => {
    expect(
      effectiveCustomInstructions(
        { customInstructions: '  \n', customInstructionsEnabled: true },
        null,
      ),
    ).toBeNull();
    expect(
      effectiveCustomInstructions(
        {
          customInstructions: '  Be terse. \n',
          customInstructionsEnabled: true,
        },
        null,
      ),
    ).toBe('Be terse.');
  });
});

describe('getEffectiveCustomInstructions', () => {
  it('reads the person’s row and the custom_instructions policy for the org', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({ enabled: true });
    const { sql, statements } = fakeSql(() => [
      row({ customInstructions: ' Be terse. ' }),
    ]);

    await expect(getEffectiveCustomInstructions(sql, SCOPE)).resolves.toBe(
      'Be terse.',
    );
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      sql,
      'org_1',
      'custom_instructions',
    );
    // The row read is scoped to BOTH the person and the org.
    expect(statements[0]?.text).toContain('FROM app.user_preferences');
    expect(statements[0]?.values).toEqual(['user_1', 'org_1']);
  });

  it('answers null for a person without a row when the org default is off', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      getEffectiveCustomInstructions(sql, SCOPE),
    ).resolves.toBeNull();
  });

  it('honours the person’s opt-out over an org default that is on', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({ enabled: true });
    const { sql } = fakeSql(() => [
      row({
        customInstructions: 'Be terse.',
        customInstructionsEnabled: false,
      }),
    ]);
    await expect(
      getEffectiveCustomInstructions(sql, SCOPE),
    ).resolves.toBeNull();
  });
});
