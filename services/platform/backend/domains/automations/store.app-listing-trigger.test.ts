// @vitest-environment node

/**
 * The app listing says what starts each automation on its own: the
 * list's Trigger column reads the binding's kind, its switch and its pause
 * stamp from the one trigger read the REST listing makes too — never a
 * guess, and never the binding's other fields (its fixed input, its webhook
 * token or a skip's detail).
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listAutomationsForApp } from './store.ts';

const ORG = 'org-1';

/** Raw `app.automation_triggers` rows as `listTriggers` selects them. */
function triggerRow(
  name: string,
  fields: {
    kind: 'schedule' | 'webhook' | 'event';
    enabled: boolean;
    lastSkipReason?: string | null;
  },
) {
  return {
    id: `t-${name}`,
    name,
    kind: fields.kind,
    cron: fields.kind === 'schedule' ? '0 9 * * 1-5' : null,
    timezone: fields.kind === 'schedule' ? 'Europe/Zurich' : null,
    event: fields.kind === 'event' ? 'task.created' : null,
    scheduleRule: null,
    catchUp: fields.kind === 'schedule' ? 'latest' : null,
    nextDueAt: fields.kind === 'schedule' && fields.enabled ? 1_800_000 : null,
    input: { team: 'ops' },
    hasToken: fields.kind === 'webhook',
    enabled: fields.enabled,
    lastFiredAt: 1_700_000,
    lastRunId: 'r-last',
    lastSkippedAt: fields.lastSkipReason == null ? null : 1_750_000,
    lastSkipReason: fields.lastSkipReason ?? null,
    lastSkipDetail: null,
    consecutiveFailures:
      fields.lastSkipReason === 'paused_after_failures' ? 5 : 0,
    lastFailedAt: null,
    lastFailureCode: null,
    lastFailedRunId: null,
  };
}

/** A tagged-template double over the three listing reads: the versions,
 * the project bindings and the triggers, each answered by its table. */
function listingSql(): {
  sql: Sql;
  reads: { text: string; values: unknown[] }[];
} {
  const reads: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    reads.push({ text, values });
    if (text.includes('FROM app.automation_triggers')) {
      return Promise.resolve([
        triggerRow('ops/digest', { kind: 'schedule', enabled: true }),
        triggerRow('ops/nightly', {
          kind: 'schedule',
          enabled: false,
          lastSkipReason: 'paused_after_failures',
        }),
        triggerRow('ops/intake', { kind: 'webhook', enabled: false }),
        triggerRow('ops/draft', { kind: 'event', enabled: true }),
      ]);
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      return Promise.resolve([]);
    }
    if (text.includes('FROM app.automations a')) {
      return Promise.resolve(
        [
          ['ops/by-hand', 1],
          ['ops/digest', 3],
          ['ops/draft', null],
          ['ops/intake', 2],
          ['ops/nightly', 1],
        ].map(([name, deployedVersion]) => ({
          name,
          latest: 3,
          deployedVersion,
          taskContract: null,
          settings: null,
          presentation: null,
        })),
      );
    }
    return Promise.reject(new Error(`unexpected read: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, reads };
}

describe('the app listing names what starts each automation', () => {
  it('reads the binding kind, switch and pause stamp, and null when nothing is bound', async () => {
    const { sql } = listingSql();
    const rows = await listAutomationsForApp(sql, ORG);
    const triggers = Object.fromEntries(
      rows.map((row) => [row.name, row.trigger]),
    );
    expect(triggers).toEqual({
      'ops/by-hand': null,
      'ops/digest': {
        kind: 'schedule',
        enabled: true,
        lastSkipReason: null,
      },
      'ops/draft': { kind: 'event', enabled: true, lastSkipReason: null },
      'ops/intake': { kind: 'webhook', enabled: false, lastSkipReason: null },
      'ops/nightly': {
        kind: 'schedule',
        enabled: false,
        lastSkipReason: 'paused_after_failures',
      },
    });
  });

  it('keeps the deployment beside the trigger, never folded into it', async () => {
    const { sql } = listingSql();
    const rows = await listAutomationsForApp(sql, ORG);
    // A trigger that is on stays on in the read when nothing is deployed;
    // the row's missing `deployedVersion` says why it starts nothing.
    expect(rows.find((row) => row.name === 'ops/draft')).toEqual({
      name: 'ops/draft',
      latest: 3,
      projectIds: [],
      trigger: { kind: 'event', enabled: true, lastSkipReason: null },
    });
  });

  it('reads the triggers once, in the organization asked about', async () => {
    const { sql, reads } = listingSql();
    await listAutomationsForApp(sql, ORG);
    const triggerReads = reads.filter((read) =>
      read.text.includes('FROM app.automation_triggers'),
    );
    expect(triggerReads).toHaveLength(1);
    expect(triggerReads[0]?.text).toContain('WHERE org_id = $?');
    expect(triggerReads[0]?.values[0]).toBe(ORG);
  });
});
