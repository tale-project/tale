// @vitest-environment node

/**
 * `assertTriggerValid` — the single validation door for a trigger's shape,
 * reached by BOTH the HTTP door (`routes.ts`) and the engine door
 * (`dispatch-store.ts`) through `setTrigger`. A schedule whose cron cannot
 * parse (or whose timezone is not a real IANA zone) must be REFUSED at save
 * with an actionable error, never saved green to silently never fire.
 */

import { describe, expect, it } from 'vitest';

import { assertTriggerValid, AutomationError } from './store.ts';

describe('assertTriggerValid', () => {
  it('accepts a valid five-field cron', () => {
    expect(() =>
      assertTriggerValid({ kind: 'schedule', cron: '0 9 * * 1' }),
    ).not.toThrow();
  });

  it('accepts a valid cron with an IANA timezone', () => {
    expect(() =>
      assertTriggerValid({
        kind: 'schedule',
        cron: '*/5 * * * *',
        timezone: 'Europe/Zurich',
      }),
    ).not.toThrow();
  });

  it('refuses a schedule with no cron', () => {
    expect(() => assertTriggerValid({ kind: 'schedule' })).toThrowError(
      AutomationError,
    );
    try {
      assertTriggerValid({ kind: 'schedule', cron: '   ' });
      expect.unreachable('blank cron must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe(
        'AUTOMATION_TRIGGER_INVALID',
      );
      expect((error as AutomationError).status).toBe(400);
    }
  });

  it('refuses a cron that cannot parse', () => {
    for (const cron of [
      'not a cron',
      '* * * *', // four fields
      '60 * * * *', // minute out of range
      '* * * * 8-9', // day-of-week out of range
      '*/0 * * * *', // zero step
    ]) {
      expect(
        () => assertTriggerValid({ kind: 'schedule', cron }),
        `cron ${JSON.stringify(cron)} must refuse`,
      ).toThrowError(AutomationError);
    }
  });

  it('refuses an unknown timezone', () => {
    try {
      assertTriggerValid({
        kind: 'schedule',
        cron: '0 9 * * *',
        timezone: 'Mars/Olympus_Mons',
      });
      expect.unreachable('bad timezone must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe(
        'AUTOMATION_TRIGGER_INVALID',
      );
    }
  });

  it('refuses an event trigger with no event name', () => {
    expect(() => assertTriggerValid({ kind: 'event' })).toThrowError(
      AutomationError,
    );
    expect(() =>
      assertTriggerValid({ kind: 'event', event: '  ' }),
    ).toThrowError(AutomationError);
  });

  it('does not require a cron for webhook or event triggers', () => {
    expect(() => assertTriggerValid({ kind: 'webhook' })).not.toThrow();
    expect(() =>
      assertTriggerValid({ kind: 'event', event: 'contact.created' }),
    ).not.toThrow();
  });
});
